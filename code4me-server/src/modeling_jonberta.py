from typing import List, Optional, Tuple, Union, Any
from copy import deepcopy
import torch, math

from torch import nn, Tensor
from torch.nn import BCEWithLogitsLoss, CrossEntropyLoss, MSELoss, init

from transformers.models.roberta.modeling_roberta import (
    RobertaForSequenceClassification,
    RobertaPreTrainedModel, 
    RobertaClassificationHead, 
    RobertaModel, 
    RobertaEncoder, 
    RobertaEmbeddings,
    RobertaPooler,
    RobertaAttention,
    RobertaIntermediate,
    RobertaOutput,
    RobertaSelfOutput,
)
from transformers.configuration_utils import PretrainedConfig
from transformers.modeling_outputs import SequenceClassifierOutput, BaseModelOutputWithPastAndCrossAttentions
from transformers.pytorch_utils import apply_chunking_to_forward

''' Encoder model with cross-attention to feature vectors 
    Based on the RobertaForSequenceClassification model, only modifying
    the necessary classes for my use-case. '''

def add_features_to_model(model, config): 
    ''' Modify the weights of the given `nn.Linear` `model_layer` to include `n_features` 
        more features, and optionally re-initialize that layer's weights. 
        Used to augment the classification head '''
    
    if not config_has(config, [add_head]):
        return model

    if not config_has(config, [num_telemetry_features]):
        raise ValueError('You should specify a `num_telemetry_features`')
    n_features = config_has(config, [num_telemetry_features])

    def rec_getattr(obj, layer):

        # recursive getattr
        layers = layer.split('.')
        prev_layer, old_layer = model, model
        for layer in layers: 
            prev_layer = old_layer
            old_layer = getattr(old_layer, layer)
        return old_layer, prev_layer, layers

    re_init = config_has(config, [reinit_head])
    if config_has(config, [add_dense, add_proj]):
        print('expanding both dense and proj')
        # C x C+m x n_labels, where C is hidden_size, m is n_features
        old_dense, prev_layer, layers = rec_getattr(model, 'classifier.dense')
        new_dense = torch.nn.Linear(
            old_dense.in_features + n_features, 
            old_dense.out_features + n_features
        )
        if not re_init:
            new_dense.weight.data[:old_dense.out_features, :old_dense.in_features] = old_dense.weight.data
            new_dense.bias.data[:old_dense.out_features] = old_dense.bias.data

        setattr(prev_layer, layers[-1], new_dense)

        old_proj, prev_layer, layers = rec_getattr(model, 'classifier.out_proj')
        new_proj = torch.nn.Linear(
            old_proj.in_features + n_features, 
            old_proj.out_features
        )
        if not re_init:
            new_proj.weight.data[:old_proj.out_features, :old_proj.in_features] = old_proj.weight.data
            new_proj.bias.data[:old_proj.out_features] = old_proj.bias.data

        setattr(prev_layer, layers[-1], new_proj)
        return model
        
    elif config_has(config, [add_dense]):
        layer_name = 'classifier.dense'
    elif config_has(config, [add_proj]):
        layer_name = 'classifier.out_proj'
    else:
        return model
    
    print(f'expanding {layer_name}')
    old_layer, prev_layer, layers = rec_getattr(model, layer_name)
    new_layer = torch.nn.Linear(old_layer.in_features + n_features, old_layer.out_features)
    if not re_init: 
        new_layer.weight.data[:, :old_layer.in_features] = old_layer.weight.data
        new_layer.bias.data = old_layer.bias.data
    old_layer = new_layer

    setattr(prev_layer, layers[-1], new_layer)

def dprint(matrix: Tensor, label: str, dims=None):
    ''' debug print method '''
    shape = matrix.shape
    if dims is not None: 
        matrix = matrix[dims]
        es = matrix.shape

    print(f'\n{label}, {shape}, {es if dims is not None else ""} \n{matrix}')

def config_has(config: PretrainedConfig, keys: tuple[str]) -> bool | Any:
    ''' Check whether config contains a given key, and return True if it is set to True. 
        The amount of built-ins called indicates that this should be a built-in python function. '''
    # if all keys are present
    if all([hasattr(config, key) for key in keys]):
        # get all values
        values = [getattr(config, key) for key in keys]
        # if all values are booleans, simply check if all are True
        if all([isinstance(value, bool) for value in values]):
            return all(values)
        # else, check if all boolean values are True, and return the last value
        elif all(filter(lambda value: isinstance(value, bool), values)):
            return values[-1]
    return False

# all modifications, and their config entries, are listed here 
num_telemetry_features = 'num_telemetry_features' # int (26)

# NOTE: Classification Head
add_head = 'add_head' # bool
add_dense = 'add_dense' # bool
add_proj = 'add_proj' # bool
reinit_head = 'reinit_head' # bool

# NOTE: Cross Attention
add_cross_attn = 'add_cross_attn' # bool
share_values = 'share_values' # bool
cross_attn_layers = 'cross_attn_layers' # list[int]

# NOTE: Self Attention
add_self_attn = 'add_self_attn' # bool
share_feature_values = 'share_self_attn_values' # bool
share_feature_keys = 'share_self_attn_keys' # bool
self_attn_layers = 'self_attn_layers' # list[int]

# NOTE: Feature Embeddings for Self Attention
add_feature_embeddings = 'add_feature_embeddings' # bool
feature_hidden_size = 'feature_hidden_size' # int (presumably in [n_feature, hidden_size], scales added param count exponentially)
feature_dropout_prob = 'feature_dropout_prob'
add_feature_bias = 'add_feature_bias' # bool

# NOTE: not in use
cross_attn_v2 = 'cross_attn_v2' # bool
share_keys = 'share_keys'   # bool
use_queries = 'use_queries' # bool

# TODO: add proper error handling if any of these are missing 

class Hadamard(nn.Module):
    '''
    Oh yeah baby, we have to make our own module for something as simple as element-wise multiplication 
    Or, at least, I cannot find a suitable equivalent in reasonable time within the PyTorch Library. 
    Surely someone must've made this already?
    '''
    __constants__ = ['in_features', 'out_features']
    in_features: int
    out_features: int
    weight: Tensor

    # Methods based on nn.Linear. However, we do not include bias by default as this 
    # does not really make sense for an element-wise multiplication.
    def __init__(self, in_features: int, out_features: int, bias: bool = False,
                 device=None, dtype=None) -> None:
        factory_kwargs = {'device': device, 'dtype': dtype}
        super().__init__()
        self.in_features = in_features
        self.out_features = out_features
        # print(factory_kwargs)
        self.weight = nn.Parameter(torch.empty((out_features, in_features), **factory_kwargs))
        if bias:
            self.bias = nn.Parameter(torch.empty((out_features, in_features), **factory_kwargs))
        else:
            self.register_parameter('bias', None)
        # print(f'before: {self.weight}')
        self.reset_parameters()
        # print(f'after: {self.weight}')

    def reset_parameters(self) -> None:
        # Setting a=sqrt(5) in kaiming_uniform is the same as initializing with
        # uniform(-1/sqrt(in_features), 1/sqrt(in_features)). For details, see
        # https://github.com/pytorch/pytorch/issues/57109
        # import pdb; pdb.set_trace()
        init.kaiming_uniform_(self.weight, a=math.sqrt(5))
        if self.bias is not None:
            fan_in, _ = init._calculate_fan_in_and_fan_out(self.weight)
            bound = 1 / math.sqrt(fan_in) if fan_in > 0 else 0
            init.uniform_(self.bias, -bound, bound)

    def forward(self, input: Tensor) -> Tensor:
        ''' NEW: Element-wise multiplication + optional bias '''
        # return F.linear(input, self.weight, self.bias)
        if self.bias is not None: 
            return torch.mul(input.unsqueeze(-1), self.weight.t()) + self.bias.t()
        return torch.mul(input.unsqueeze(-1), self.weight.t()) 

    def extra_repr(self) -> str:
        return f'in_features={self.in_features}, out_features={self.out_features}, bias={self.bias is not None}'

class JonbertaEmbeddings(nn.Module):
    ''' embeddings with a spicy kick for scalar feature data 
        learns a nonlinear function for each item in the embedding of the feature '''

    def __init__(self, config):
        super().__init__()

        if not hasattr(config, feature_hidden_size):
            raise ValueError('You should specify a `feature_hidden_size`, or at least set it to `hidden_size`')
        
        self.feature_embeddings = Hadamard(
            config.get(num_telemetry_features), config.get(feature_hidden_size), 
            bias = config.get(add_feature_bias)) 
        # self.softmax = nn.functional.softmax 
        self.nonlinear = nn.functional.gelu
        # TODO: actually read layernorm documentation
        self.layer_norm = nn.LayerNorm(config.get(feature_hidden_size)) 
        self.dropout = nn.Dropout(config.get(feature_dropout_prob))

        # dprint(self.feature_embeddings.weight, 'emb weights', 0)
        # dprint(self.feature_embeddings.bias, 'emb bias', 0)

    def forward(self, features=None): # , token_type_ids=None, position_ids=None, inputs_embeds=None, past_key_values_length=0
        
        # dprint(self.feature_embeddings.weight, 'emb weights')
        # dprint(self.feature_embeddings.bias, 'emb bias')
        # dprint(features, 'features', 0)
        embeddings = self.feature_embeddings(features)
        # dprint(embeddings, 'embedded', 0)
        # TODO: bias term may not be necessary in embeddings, as we normalise after
        embeddings = self.layer_norm(embeddings)
        # dprint(embeddings, 'normed', 0)
        # TODO: try out layer_norm after gelu, as gelu does not map everything negative to 0 and thus biases the layer norm less 
        embeddings = self.nonlinear(embeddings)
        # dprint(embeddings, 'nonlinear', 0)

        embeddings = self.dropout(embeddings)
        # dprint(embeddings, 'dropout', 0)

        return embeddings

class JonbertaEncoder(RobertaEncoder):
    ''' Custom encoder so we can specify our custom JonbertaLayer '''
    def __init__(self, config):
        super(RobertaEncoder, self).__init__() # Changed super() -> super(RobertaEncoder, self)
        self.config = config
        
        # would've loved to put this in the JonbertaModel along WE, but im not copying over that entire forward() function
        if config.get(add_feature_embeddings):
            self.feature_embeddings = JonbertaEmbeddings(config)

        self.layer = nn.ModuleList([JonbertaLayer(config, layer_idx=i) for i in range(config.num_hidden_layers)]) # Changed RobertaLayer -> JonbertaLayer
        self.gradient_checkpointing = False

        # NOTE: I hate this 'design pattern' but I am out of alternatives, Python...
        if config.get(add_cross_attn, share_values):
            self.shared_value = Hadamard(config.num_telemetry_features, config.hidden_size) # without bias
        elif config.get(add_self_attn):
            if config.get(share_feature_values):
                self.shared_value = nn.Linear(config.num_telemetry_features, config.hidden_size)
            if config.get(share_feature_keys):
                self.shared_keys = nn.Linear(config.num_telemetry_features, config.hidden_size)

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.FloatTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.FloatTensor] = None,
        encoder_attention_mask: Optional[torch.FloatTensor] = None,
        past_key_values: Optional[Tuple[Tuple[torch.FloatTensor]]] = None,
        use_cache: Optional[bool] = None,
        output_attentions: Optional[bool] = False,
        output_hidden_states: Optional[bool] = False,
        return_dict: Optional[bool] = True,
    ) -> Union[Tuple[torch.Tensor], BaseModelOutputWithPastAndCrossAttentions]:

        if self.config.get(add_feature_embeddings):
            encoder_hidden_states = self.feature_embeddings(encoder_hidden_states)

        if self.config.get(add_cross_attn, share_values):
            encoder_hidden_states = self.shared_value(encoder_hidden_states)
            encoder_hidden_states = encoder_hidden_states.unsqueeze(1) # for handling the single T dimension 
        
        if self.config.get(add_self_attn, share_feature_values):
            encoder_values = self.shared_value(encoder_hidden_states).unsqueeze(1)
            raise NotImplementedError('Shared values (self-attn) not implemented yet')

        if self.config.get(add_self_attn, share_feature_keys):
            encoder_keys = self.shared_keys(encoder_hidden_states).unsqueeze(1)
            raise NotImplementedError('Shared keys (self-attn) not implemented yet')

        
        return super().forward(
            hidden_states,
            attention_mask=attention_mask,
            head_mask=head_mask,
            encoder_hidden_states=encoder_hidden_states,
            encoder_attention_mask=encoder_attention_mask,
            past_key_values=past_key_values,
            use_cache=use_cache,
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )

class JonbertaLayer(nn.Module):
    ''' Layer with following potential additions: 
        - modified self-attention with KV from features (config.add_self_attn)
        - modified cross-attention with KV from features (config.add_cross_attn)
    '''

    def __init__(self, config, layer_idx=None):
        super().__init__()
        self.chunk_size_feed_forward = config.chunk_size_feed_forward
        self.seq_len_dim = 1
        self.layer_idx = layer_idx
        self.config = config

        self.custom_self_attn = config.get(add_self_attn) and layer_idx in config.get(self_attn_layers)
        self.custom_cross_attn = config.get(add_cross_attn) and layer_idx in config.get(cross_attn_layers)

        if self.custom_self_attn and self.custom_cross_attn:
            raise ValueError('Should not specify both custom self- and cross-attention.')

        if self.custom_self_attn:
            print(f'Adding custom self-attention to layer {layer_idx}')
            self.attention = JonbertaSelfAttention(config) 

        elif self.custom_cross_attn:
            print(f'Adding custom cross-attention to layer {layer_idx}')
            self.attention = JonbertaCrossAttention(config, layer_idx=layer_idx)

        else:
            self.attention = RobertaAttention(config) # original RobertaSelfAttention
       
        self.intermediate = RobertaIntermediate(config)
        self.output = RobertaOutput(config)

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.FloatTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.FloatTensor] = None,
        encoder_attention_mask: Optional[torch.FloatTensor] = None,
        past_key_value: Optional[Tuple[Tuple[torch.FloatTensor]]] = None,
        output_attentions: Optional[bool] = False,
    ) -> Tuple[torch.Tensor]:
        # decoder uni-directional self-attention cached key/values tuple is at positions 1,2
        self_attn_past_key_value = past_key_value[:2] if past_key_value is not None else None
        self_attention_outputs = self.attention(
            hidden_states,
            attention_mask,
            head_mask,
            output_attentions=output_attentions,
            past_key_value=self_attn_past_key_value,
            # we only want to pass encoder_hidden_states (features) to our own SelfAttention module, 
            # as otherwise the RobertaAttention module will act like cross-attention and ignore the token embs
            encoder_hidden_states=encoder_hidden_states if self.custom_self_attn else None,
            encoder_attention_mask=encoder_attention_mask if self.custom_self_attn else None,
        )
        attention_output = self_attention_outputs[0]

        # if decoder, the last output is tuple of self-attn cache
        if self.config.get(add_cross_attn):
            outputs = self_attention_outputs[1:-1]
            present_key_value = (self_attention_outputs[-1],) # NOTE: What's this for? 
        else:
            outputs = self_attention_outputs[1:]  # add self attentions if we output attention weights

        cross_attn_present_key_value = None
        
        if encoder_hidden_states is not None:

            # and self.add_cross_attention: # NOTE: Changed from `and self.is_decoder`
            # if not hasattr(self, "crossattention"):
            #     raise ValueError(
            #         f"If `encoder_hidden_states` are passed, {self} has to be instantiated with cross-attention layers"
            #         " by setting `config.add_cross_attention=True`"
            #     )
            if self.config.get(add_cross_attn):
                
                # cross_attn cached key/values tuple is at positions 3,4 of past_key_value tuple
                cross_attn_past_key_value = past_key_value[-2:] if past_key_value is not None else None
                cross_attention_outputs = self.crossattention(
                    attention_output,
                    attention_mask,
                    head_mask,
                    encoder_hidden_states,
                    encoder_attention_mask,
                    cross_attn_past_key_value,
                    output_attentions,
                )
                attention_output = cross_attention_outputs[0]
                outputs = outputs + cross_attention_outputs[1:-1]  # add cross attentions if we output attention weights

                # add cross-attn cache to positions 3,4 of present_key_value tuple
                # cross_attn_present_key_value = cross_attention_outputs[-1]
                # present_key_value = present_key_value + cross_attn_present_key_value

            else:  # no cross-attention, just append the cross_attn_past_key_value for potential future layers
                # present_key_value = present_key_value + cross_attn_past_key_value
                pass 

        layer_output = apply_chunking_to_forward(
            self.feed_forward_chunk, self.chunk_size_feed_forward, self.seq_len_dim, attention_output
        )
        outputs = (layer_output,) + outputs

        # if decoder, return the attn key/values as the last output
        if self.config.get(add_cross_attn): # NOTE: changed from `self.is_decoder:`
            outputs = outputs + (present_key_value,)

        return outputs

    def feed_forward_chunk(self, attention_output):
        intermediate_output = self.intermediate(attention_output)
        layer_output = self.output(intermediate_output, attention_output)
        return layer_output

class JonbertaSelfAttention(nn.Module):
    def __init__(self, config, position_embedding_type=None):
        super().__init__()
        self.self = SelfAttention(config, position_embedding_type=position_embedding_type)
        self.output = RobertaSelfOutput(config)
        self.pruned_heads = set()

    def prune_heads(self, heads):
        raise NotImplementedError('Pruning not (yet) implemented for Jonberta model')
        # if len(heads) == 0:
        #     return
        # heads, index = find_pruneable_heads_and_indices(
        #     heads, self.self.num_attention_heads, self.self.attention_head_size, self.pruned_heads
        # )

        # # Prune linear layers
        # self.self.query = prune_linear_layer(self.self.query, index)
        # self.self.key = prune_linear_layer(self.self.key, index)
        # self.self.value = prune_linear_layer(self.self.value, index)
        # self.output.dense = prune_linear_layer(self.output.dense, index, dim=1)

        # # Update hyper params and store pruned heads
        # self.self.num_attention_heads = self.self.num_attention_heads - len(heads)
        # self.self.all_head_size = self.self.attention_head_size * self.self.num_attention_heads
        # self.pruned_heads = self.pruned_heads.union(heads)

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.FloatTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.FloatTensor] = None,
        encoder_attention_mask: Optional[torch.FloatTensor] = None,
        past_key_value: Optional[Tuple[Tuple[torch.FloatTensor]]] = None,
        output_attentions: Optional[bool] = False,
    ) -> Tuple[torch.Tensor]:
        self_outputs = self.self(
            hidden_states,
            attention_mask,
            head_mask,
            encoder_hidden_states,
            encoder_attention_mask,
            past_key_value,
            output_attentions,
        )
        attention_output = self.output(self_outputs[0], hidden_states)
        outputs = (attention_output,) + self_outputs[1:]  # add attentions if we output them
        return outputs

class SelfAttention(nn.Module):
    def __init__(self, config, position_embedding_type=None):
        super().__init__()
        if config.hidden_size % config.num_attention_heads != 0 and not hasattr(config, "embedding_size"):
            raise ValueError(
                f"The hidden size ({config.hidden_size}) is not a multiple of the number of attention "
                f"heads ({config.num_attention_heads})"
            )

        self.num_attention_heads = config.num_attention_heads
        self.attention_head_size = int(config.hidden_size / config.num_attention_heads)
        self.all_head_size = self.num_attention_heads * self.attention_head_size

        self.query = nn.Linear(config.hidden_size, self.all_head_size)
        self.key = nn.Linear(config.hidden_size, self.all_head_size)
        self.value = nn.Linear(config.hidden_size, self.all_head_size)

        self.f_key = nn.Linear(config.get(feature_hidden_size), self.all_head_size) \
            if not config.get(share_feature_keys) else None
        self.f_value = nn.Linear(config.get(feature_hidden_size), self.all_head_size) \
            if not config.get(share_feature_values) else None

        self.dropout = nn.Dropout(config.attention_probs_dropout_prob)
        self.position_embedding_type = position_embedding_type or getattr(
            config, "position_embedding_type", "absolute"
        )
        if self.position_embedding_type == "relative_key" or self.position_embedding_type == "relative_key_query":
            self.max_position_embeddings = config.max_position_embeddings
            self.distance_embedding = nn.Embedding(2 * config.max_position_embeddings - 1, self.attention_head_size)

    def transpose_for_scores(self, x: torch.Tensor) -> torch.Tensor:
        new_x_shape = x.size()[:-1] + (self.num_attention_heads, self.attention_head_size)
        x = x.view(new_x_shape)
        return x.permute(0, 2, 1, 3)

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.FloatTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.FloatTensor] = None,
        encoder_attention_mask: Optional[torch.FloatTensor] = None,
        past_key_value: Optional[Tuple[Tuple[torch.FloatTensor]]] = None,
        output_attentions: Optional[bool] = False,
    ) -> Tuple[torch.Tensor]:

        key_layer = self.transpose_for_scores(self.key(hidden_states))
        value_layer = self.transpose_for_scores(self.value(hidden_states))
        query_layer = self.transpose_for_scores(self.query(hidden_states))

        use_cache = past_key_value is not None # should be None, not a decoder model 

        # Take the dot product between "query" and "key" to get the raw attention scores.
        attention_scores = torch.matmul(query_layer, key_layer.transpose(-1, -2))

        if self.position_embedding_type == "relative_key" or self.position_embedding_type == "relative_key_query":
            query_length, key_length = query_layer.shape[2], key_layer.shape[2]
            if use_cache:
                position_ids_l = torch.tensor(key_length - 1, dtype=torch.long, device=hidden_states.device).view(
                    -1, 1
                )
            else:
                position_ids_l = torch.arange(query_length, dtype=torch.long, device=hidden_states.device).view(-1, 1)
            position_ids_r = torch.arange(key_length, dtype=torch.long, device=hidden_states.device).view(1, -1)
            distance = position_ids_l - position_ids_r

            positional_embedding = self.distance_embedding(distance + self.max_position_embeddings - 1)
            positional_embedding = positional_embedding.to(dtype=query_layer.dtype)  # fp16 compatibility

            if self.position_embedding_type == "relative_key":
                relative_position_scores = torch.einsum("bhld,lrd->bhlr", query_layer, positional_embedding)
                attention_scores = attention_scores + relative_position_scores
            elif self.position_embedding_type == "relative_key_query":
                relative_position_scores_query = torch.einsum("bhld,lrd->bhlr", query_layer, positional_embedding)
                relative_position_scores_key = torch.einsum("bhrd,lrd->bhlr", key_layer, positional_embedding)
                attention_scores = attention_scores + relative_position_scores_query + relative_position_scores_key

        attention_scores = attention_scores / math.sqrt(self.attention_head_size)
        if attention_mask is not None:
            # Apply the attention mask is (precomputed for all layers in RobertaModel forward() function)
            attention_scores = attention_scores + attention_mask

        # Normalize the attention scores to probabilities.
        attention_probs = nn.functional.softmax(attention_scores, dim=-1)
        attention_probs = self.dropout(attention_probs)

        # Mask heads if we want to
        if head_mask is not None: 
            attention_probs = attention_probs * head_mask

        context_layer = torch.matmul(attention_probs, value_layer)

        context_layer = context_layer.permute(0, 2, 1, 3).contiguous()
        new_context_layer_shape = context_layer.size()[:-2] + (self.all_head_size,)
        context_layer = context_layer.view(new_context_layer_shape)

        # NOTE: Custom dual-attention to features (encoder_hidden_states)
        if encoder_hidden_states is not None:

            if self.f_key is not None: # no shared keys
                encoder_key_layer = self.transpose_for_scores(self.f_key(encoder_hidden_states))
            if self.f_value is not None: 
                encoder_value_layer = self.transpose_for_scores(self.f_value(encoder_hidden_states))

            # using the same token emb queries, we compute attention scores to our feature keys
            encoder_attention_scores = torch.matmul(query_layer, encoder_key_layer.transpose(-1, -2))
            encoder_attention_scores = encoder_attention_scores / math.sqrt(self.attention_head_size)

            encoder_attention_probs = nn.functional.softmax(encoder_attention_scores, dim=-1)
            encoder_attention_probs = self.dropout(encoder_attention_probs)

            encoder_context_layer = torch.matmul(encoder_attention_probs, encoder_value_layer)

            encoder_context_layer = encoder_context_layer.permute(0, 2, 1, 3).contiguous()
            new_context_layer_shape = encoder_context_layer.size()[:-2] + (self.all_head_size,)
            encoder_context_layer = encoder_context_layer.view(new_context_layer_shape)

            # naively add these to the code context layer, as this is what is done to the residual
            # `hidden_states` in the original SelfOutput module anyway. 
            context_layer += encoder_context_layer

        else: 
            raise ValueError('JonbertaSelfAttention used without features (`encoder_hidden_states`).')

        outputs = (context_layer, attention_probs) if output_attentions else (context_layer,)
        if output_attentions: 
            raise ValueError('Output attentions not supported for Jonberta model, as we are applying feature attention too.')

        # if self.is_decoder:
        #     outputs = outputs + (past_key_value,)
        #     raise ValueError('Jonberta is not a decoder model')

        return outputs

### Attention and Cross-Attention Modules. 
# NOTE: may not be necessary, default Roberta implements cross-attn. 
# However, it may not handle K, V weights properly as it is for sequences,
# and not telemetry feature vectors.

class JonbertaCrossAttention(nn.Module):
    def __init__(self, config, layer_idx):
        super().__init__()
        # self.self = RobertaSelfAttention(config, position_embedding_type=position_embedding_type)
        # self.output = RobertaSelfOutput(config)
        self.self = ScaledCrossAttention(config, layer_idx=layer_idx) if \
            not config.get(cross_attn_v2) else NonLinearCrossAttention(config, layer_idx)# Changed RobertaSelfAttention -> JonbertaCrossAttention
        self.output = JonbertaSelfOutput(config)

        self.pruned_heads = set()

    def prune_heads(self, heads):
        raise NotImplementedError('Pruning not (yet) implemented for Jonberta model')
        # if len(heads) == 0:
        #     return
        # heads, index = find_pruneable_heads_and_indices(
        #     heads, self.self.num_attention_heads, self.self.attention_head_size, self.pruned_heads
        # )

        # # Prune linear layers
        # self.self.query = prune_linear_layer(self.self.query, index)
        # self.self.key = prune_linear_layer(self.self.key, index)
        # self.self.value = prune_linear_layer(self.self.value, index)
        # self.output.dense = prune_linear_layer(self.output.dense, index, dim=1)

        # # Update hyper params and store pruned heads
        # self.self.num_attention_heads = self.self.num_attention_heads - len(heads)
        # self.self.all_head_size = self.self.attention_head_size * self.self.num_attention_heads
        # self.pruned_heads = self.pruned_heads.union(heads)

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.FloatTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.FloatTensor] = None,
        encoder_attention_mask: Optional[torch.FloatTensor] = None,
        past_key_value: Optional[Tuple[Tuple[torch.FloatTensor]]] = None,
        output_attentions: Optional[bool] = False,
    ) -> Tuple[torch.Tensor]:

        self_outputs = self.self(
            hidden_states,
            attention_mask,
            head_mask,
            encoder_hidden_states,
            encoder_attention_mask,
            past_key_value,
            output_attentions,
        )
        attention_output = self.output(self_outputs[0], hidden_states)
        outputs = (attention_output,) + self_outputs[1:]  # add attentions if we output them
        return outputs
class NonLinearCrossAttention(nn.Module):
    ''' Scaling embeddings (like below) may not be the best idea in transformers where so much 
        attention is paid to explicit and implicit normalisation. So, instead, we learn
        a wx+b function for each element in the embedding vector from the scalar feature.

        In short: 
        - Learn embeddings (and how they change as the feature scales) through Hadamard layer 
        - Apply softmax to allow for non-linearity
        - (potentially) repeat this process for more complex patterns to be learnt
        - Apply LayerNorm for explicit normalisation of those values
        - Decode into C dimension, given that we cannot learn 1M new parameters from 20k samples
        - Optionally can support multiple heads 

        Parameters for this layer:
        - `config.num_telemetry_features`
        - `config.hidden_size` is the dimension of the token embeddings (what is output)
        - `config.num_cross_attn_heads` is the number of heads to use for $V$ in cross-attention
        - `config.cross_attn_dropout_probs` is the dropout probability for cross-attention
        - `config.share_values` is a boolean to share the weights across heads (learned in JonbertaEncoder)
        '''

    def __init__(self, config, layer_idx=None):
        super().__init__()
        if config.hidden_size % config.num_attention_heads != 0 and not hasattr(config, "embedding_size"):
            raise ValueError(
                f"The hidden size ({config.hidden_size}) is not a multiple of the number of attention "
                f"heads ({config.num_attention_heads})"
            )
        if not config.get(feature_hidden_size):
            raise ValueError('NonLinearCrossAttention requires a feature_hidden_size to learn the embeddings.')

        self.layer_idx = layer_idx 

        self.query = nn.Linear(config.feature_hidden_size, self.all_head_size) if \
            not config.get(use_queries) else None
        self.key = nn.Linear(config.feature_hidden_size, self.all_head_size) if \
            not config.get(share_keys) else None
        self.value = nn.Linear(config.feature_hidden_size, self.all_head_size) if \
            not config.get(share_values) else None

        # TODO: For now, let's assume the simplest case where no values are shared
        # and we don't use queries as they they would imply a fully parallel transformer to this one

        self.num_cross_attention_heads = config.num_cross_attn_heads
        self.attention_head_size = int(config.num_telemetry_features / config.num_cross_attn_heads)
        self.all_head_size = self.num_cross_attention_heads * self.attention_head_size

        self.share_values = config.share_values
        if not config.share_values: # first layer with cross-attn, so init shared vals 
            self.value = Hadamard(config.num_telemetry_features, config.hidden_size)

        self.dropout = nn.Dropout(config.cross_attn_dropout_probs)

class ScaledCrossAttention(nn.Module):
    ''' Cross-attention with feature embeddings scaled by the value of that feature. '''

    def __init__(self, config, layer_idx=None):
        super().__init__()
        if config.hidden_size % config.num_attention_heads != 0 and not hasattr(config, "embedding_size"):
            raise ValueError(
                f"The hidden size ({config.hidden_size}) is not a multiple of the number of attention "
                f"heads ({config.num_attention_heads})"
            )

        self.layer_idx = layer_idx 
        self.qk = nn.Linear(config.hidden_size, config.num_telemetry_features)

        # TODO: remove this MH logic, as we don't have multiple heads. 
        self.num_cross_attention_heads = config.num_cross_attn_heads
        assert self.num_cross_attention_heads == 1, "Only one cross-attention head is supported for now."
        self.attention_head_size = int(config.num_telemetry_features / config.num_cross_attn_heads)
        self.all_head_size = self.num_cross_attention_heads * self.attention_head_size

        self.share_values = config.share_values
        if not config.share_values: # first layer with cross-attn, so init shared vals 
            self.value = Hadamard(config.num_telemetry_features, config.hidden_size)

        self.dropout = nn.Dropout(config.cross_attn_dropout_probs)

    def transpose_for_scores(self, x: torch.Tensor) -> torch.Tensor:
        new_x_shape = x.size()[:-1] + (self.num_cross_attention_heads, self.attention_head_size)
        x = x.view(new_x_shape)
        return x.permute(0, 2, 1, 3)

    def forward(
        self,
        hidden_states: torch.Tensor,
        attention_mask: Optional[torch.FloatTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.FloatTensor] = None,
        encoder_attention_mask: Optional[torch.FloatTensor] = None,
        past_key_value: Optional[Tuple[Tuple[torch.FloatTensor]]] = None,
        output_attentions: Optional[bool] = False,
    ) -> Tuple[torch.Tensor]:

        if not self.share_values: 
            value_layer = self.value(encoder_hidden_states)
            value_layer = value_layer.unsqueeze(1)
            past_key_value = (None, value_layer)
        else: 
            value_layer = encoder_hidden_states

        # weighted sum of features per embedded token vector
        # query_layer = self.transpose_for_scores(self.query(hidden_states))
        mixed_query_layer = self.qk(hidden_states)

        # Take the dot product between "query" and "key" to get the raw attention scores.
        # attention_scores = torch.matmul(query_layer, key_layer.transpose(-1, -2))
        attention_scores = self.transpose_for_scores(mixed_query_layer)
        # attention_scores = attention_scores / math.sqrt(self.attention_head_size)
        attention_scores /= math.sqrt(attention_scores.size(-1))

        if encoder_attention_mask is not None:
            # Apply the attention mask is (precomputed for all layers in RobertaModel forward() function)
            # attention_scores = attention_scores + encoder_attention_mask
            raise ValueError('No need to mask a feature vector')

        # Normalize the attention scores to probabilities.
        attention_probs = nn.functional.softmax(attention_scores, dim=-1)
        attention_probs = self.dropout(attention_probs)

        if head_mask is not None: # Mask heads if we want to
            # attention_probs = attention_probs * head_mask
            raise ValueError('Jonberta does not have multiple heads: you do not want to mask')

        context_layer = torch.matmul(attention_probs, value_layer)

        # context_layer = context_layer.permute(0, 2, 1, 3).contiguous()
        # new_context_layer_shape = context_layer.size()[:-2] + (self.all_head_size,)
        # context_layer = context_layer.view(new_context_layer_shape)
        context_layer = context_layer.squeeze(1) # get rid of that one head dim

        outputs = (context_layer, attention_probs) if output_attentions else (context_layer,)
        outputs = outputs + (past_key_value,) # include for subsequent layers

        return outputs

# Copied from transformers.models.bert.modeling_bert.BertSelfOutput
class JonbertaSelfOutput(nn.Module):
    def __init__(self, config):
        super().__init__()

        if config.add_dense_layer:
            # with dense means more implicit regularisation, which can help because telemetry data is not at all regularised
            # however, also comes at a penalty of 18k extra weights to train & store 
            self.dense = nn.Linear(config.hidden_size, config.hidden_size)

        self.has_dense = config.add_dense_layer
        self.LayerNorm = nn.LayerNorm(config.hidden_size, eps=config.layer_norm_eps)
        self.dropout = nn.Dropout(config.cross_attn_dropout_probs)

    def forward(self, hidden_states: torch.Tensor, input_tensor: torch.Tensor) -> torch.Tensor:

        if self.has_dense: 
            hidden_states = self.dense(hidden_states)

        hidden_states = self.dropout(hidden_states)
        hidden_states = self.LayerNorm(hidden_states + input_tensor)
        return hidden_states

class JonbertaModel(RobertaModel):
    ''' This model behaves as an encoder, but can take an additional feature sequence to pay attention to. 
        This can work by either:

        1. Extending the self-attention with learned feature Keys and Values. (`config.add_self_attn`)
        2. Incorporating cross-attention layers, with learned Query-Key and Values. (`config.add_cross_attn`)
            We combine Query-Key into one matrix, as features are always provided in the same order. 

        .. _*Attention is all you need*: https://arxiv.org/abs/1706.03762 '''

    def __init__(self, config, add_pooling_layer=True):
        super(RobertaModel, self).__init__(config) # Changed super() -> super(RobertaModel, self)
        self.config = config

        self.embeddings = RobertaEmbeddings(config)
        self.encoder = JonbertaEncoder(config) # Changed RobertaEncoder -> JonbertaEncoder

        self.pooler = RobertaPooler(config) if add_pooling_layer else None # we don't use this

        # Initialize weights and apply final processing
        self.post_init()

class JonbertaForSequenceClassification(RobertaPreTrainedModel):
    ''' Custom Joint attention model for sequence classification. '''

    def __init__(self, config):
        
        super().__init__(config) # Changed super() -> super(RobertaForSequenceClassification, self)
        self.num_labels = config.num_labels

        self.config = deepcopy(config) # create a copy otherwise saving breaks 
        config.get = lambda *args: config_has(config, args)

        self.roberta = JonbertaModel(config, add_pooling_layer=False) # Changed RobertaModel -> JonbertaModel
        self.classifier = RobertaClassificationHead(config) \
            if not config.get(add_head) else JobertaClassificationHead(config) 

        self.add_features_in_head = config.get(add_head)

        # Initialize weights and apply final processing
        self.post_init()

    def forward(
        self,
        input_ids: Optional[torch.LongTensor] = None,
        attention_mask: Optional[torch.FloatTensor] = None,
        token_type_ids: Optional[torch.LongTensor] = None,
        position_ids: Optional[torch.LongTensor] = None,
        head_mask: Optional[torch.FloatTensor] = None,
        inputs_embeds: Optional[torch.FloatTensor] = None,
        encoder_hidden_states: Optional[torch.Tensor] = None,
        labels: Optional[torch.LongTensor] = None,
        output_attentions: Optional[bool] = None,
        output_hidden_states: Optional[bool] = None,
        return_dict: Optional[bool] = None,
    ) -> Union[Tuple[torch.Tensor], SequenceClassifierOutput]:
        r"""
        labels (`torch.LongTensor` of shape `(batch_size,)`, *optional*):
            Labels for computing the sequence classification/regression loss. Indices should be in `[0, ...,
            config.num_labels - 1]`. If `config.num_labels == 1` a regression loss is computed (Mean-Square loss), If
            `config.num_labels > 1` a classification loss is computed (Cross-Entropy).
        NOTE: added encoder_hidden_states to forward
        """
        return_dict = return_dict if return_dict is not None else self.config.use_return_dict

        outputs = self.roberta(
            input_ids,
            attention_mask=attention_mask,
            token_type_ids=token_type_ids,
            position_ids=position_ids,
            head_mask=head_mask,
            inputs_embeds=inputs_embeds,
            encoder_hidden_states=encoder_hidden_states, # NOTE: added encoder_hidden_states
            output_attentions=output_attentions,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
        )
        sequence_output = outputs[0]
        logits = self.classifier(sequence_output) if not self.add_features_in_head \
            else self.classifier(sequence_output, telemetry_features=encoder_hidden_states)

        loss = None
        if labels is not None:
            # move labels to correct device to enable model parallelism
            labels = labels.to(logits.device)
            if self.config.problem_type is None:
                if self.num_labels == 1:
                    self.config.problem_type = "regression"
                elif self.num_labels > 1 and (labels.dtype == torch.long or labels.dtype == torch.int):
                    self.config.problem_type = "single_label_classification"
                else:
                    self.config.problem_type = "multi_label_classification"

            if self.config.problem_type == "regression":
                loss_fct = MSELoss()
                if self.num_labels == 1:
                    loss = loss_fct(logits.squeeze(), labels.squeeze())
                else:
                    loss = loss_fct(logits, labels)
            elif self.config.problem_type == "single_label_classification":
                loss_fct = CrossEntropyLoss()
                loss = loss_fct(logits.view(-1, self.num_labels), labels.view(-1))
            elif self.config.problem_type == "multi_label_classification":
                loss_fct = BCEWithLogitsLoss()
                loss = loss_fct(logits, labels)

        if not return_dict:
            output = (logits,) + outputs[2:]
            return ((loss,) + output) if loss is not None else output

        return SequenceClassifierOutput(
            loss=loss,
            logits=logits,
            hidden_states=outputs.hidden_states,
            attentions=outputs.attentions,
        )

class JobertaClassificationHead(RobertaClassificationHead):
    """Head for sentence-level classification tasks."""

    def __init__(self, config):

        super(RobertaClassificationHead, self).__init__() 

        if not config.get(add_dense) and not config.get(add_proj):
            print('WARNING: both add_dense and add_proj are False, so this head will function like RoBERTa\'s')

        # NOTE: added features 
        self.add_dense = config.get(add_dense)
        self.add_proj = config.get(add_proj)

        self.dense = nn.Linear(config.hidden_size, config.hidden_size)
        classifier_dropout = (
            config.classifier_dropout if config.classifier_dropout is not None else config.hidden_dropout_prob
        )
        self.dropout = nn.Dropout(classifier_dropout)
        self.out_proj = nn.Linear(config.hidden_size, config.num_labels)

    def forward(self, features, telemetry_features=None, **kwargs):

        if telemetry_features is None or \
            not (self.add_dense or self.add_proj): 

            x = features[:, 0, :]  # take <s> token (equiv. to [CLS]); shape (B, C) for T[0]
            x = self.dropout(x)
            x = self.dense(x)
            x = torch.tanh(x)
            x = self.out_proj(x)
            return x 

        # features: (batch_size, seq_len, hidden_size)
        x = features[:, 0, :]  # take <s> token (equiv. to [CLS]); shape (B, C) for T[0] 
        
        # concatenate x and telemetry_features for DROPOUT (& dense)
        if self.add_dense:
            assert telemetry_features is not None, 'need to pass telemetry features as `encoder_hidden_states`'
            x = torch.cat((x, telemetry_features), dim=1)

        x = self.dropout(x)
        x = self.dense(x)
        x = torch.tanh(x)

        # concatenate x and telemetry features for DROPOUT (& projection)
        if self.add_proj and not self.add_dense: 
            x = torch.cat((x, telemetry_features), dim=1)

        x = self.dropout(x)
        x = self.out_proj(x)

        return x

