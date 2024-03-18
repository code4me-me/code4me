import os, math, enum, torch, numpy as np

from modeling_jonberta import JonbertaForSequenceClassification, add_features_to_model
from transformers import TextClassificationPipeline, AutoTokenizer, AutoConfig
from safetensors import safe_open

MODELS_DIR = 'models'
DEVICE = 1 if torch.cuda.is_available() else -1 


intercept, coef = 3.73303724, np.array([ 0.00860799, -0.03679135, -0.06289737,  0.4488578 , -0.40977991, -0.57503621, -0.41543147,  0.02215769, -0.56694562,  0.62073879, -0.26658544, -0.33758971, -0.19398661,  0.10083877,  0.29011958, 0.01642904,  0.082694  , -0.45812433,  0.19563108,  1.11585148, -0.12549902, -0.03319017,  0.        ,  0.37221593,  0.20887294, 0.59667318, -0.76727645, -2.23206534,  0.        ,  0.        , 0.        ,  0.        , -0.52622741, -1.80321186, -0.65761382, -0.66972758,  0.        , -2.12369698, -3.08559028, -2.64399433, -2.17775627, -0.72525643, -1.94062537, -0.64899621,  0.        , 0.07055691,  0.        ,  0.        ,  0.        ,  0.        , 0.        ,  0.        ,  0.        ,  0.        , -4.80829315, -2.20680964, -3.35584853, -3.23677452,  0.        ,  0.        , 0.16874269,  0.46803166,  0.6497761 ,  0.52477345,  0.5324576 , 0.51661321,  0.33516685,  0.27858223,  0.39369077,  0.1905836 , 0.11973277,  0.3743934 ,  0.40315233,  0.48388634,  0.32372177, 0.6324842 ,  0.09022166,  0.38000563,  0.4746545 ,  0.54397314, 0.22015718,  0.11972259,  0.33946541,  0.29087561,  0.16096189, 0.18354135, -1.20029481,  0.03437284,  0.08835093, -1.75083818, 0.97368022,  0.        ,  1.54601348,  0.72473379,  1.00326585, 1.8238706 ,  2.44167387,  1.74815122,  0.79420007,  1.53473857, 1.08563755,  0.53734968,  0.55176486,  0.98191938,  0.90612076, 1.81525461,  1.21869578,  1.07433351,  0.40708646,  2.276902  , 1.85239634,  2.01438915,  0.77927204,  0.67669704,  0.69432173, 0.72461073,  0.75737211,  0.27126203, -2.08431261, -1.47177109, 0.02996505, -0.47417774,  0.        ,  0.        ,  0.        , 0.        ,  0.        , -0.964373  , -0.84868705, -0.65761382, -1.42460126,  0.        , -1.47293568, -0.94525298, -0.60052356, -1.12780257, -1.92249699, -1.66530837, -0.64899621,  0.        , 0.07055691,  0.        ,  0.        ,  0.        ,  0.        , 0.        ,  0.        ,  0.        ,  0.        , -1.35681768, -0.80897361, -0.16270093, -0.69864107,  0.        ,  0.        , 0.16874269,  0.46803166,  0.6497761 ,  0.52477345,  0.5324576 , 0.51661321,  0.33516685,  0.27858223,  0.39369077,  0.1905836 , 0.11973277,  0.3743934 ,  0.40315233,  0.48388634, -0.0571159 , 0.6324842 ,  0.09022166,  0.38000563,  0.4746545 ,  0.54397314, 0.22015718,  0.11972259,  0.33946541,  0.29087561,  0.16096189, 0.18354135, -1.79744913,  0.03437284,  0.08835093, -1.75083818, 0.97368022,  0.        ,  0.33769289,  0.72473379,  1.00326585, -0.47593682, -0.28913642, -0.47461482,  0.79420007, -1.07146562, 1.08563755,  0.53734968,  0.55176486,  1.25787508,  0.90612076, -0.05355035,  0.74789048,  1.07433351,  0.40708646, -0.71501723, -0.04197237,  0.10833025,  0.77927204,  0.67669704,  0.75031618, 0.72461073,  0.75737211,  0.27126203, -1.3740823 , -1.18380704, 0.02996505, -0.47417774])
tokenizer = AutoTokenizer.from_pretrained('huggingface/CodeBERTa-small-v1')

from transformers import set_seed 
import random 
def set_all_seeds(seed=42):
    set_seed(seed)
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)
    # torch.distributed.barrier()


class Logres:

    SUPPORTED_LANGS = [
        'javascript', 'typescript', 'typescriptreact', 'python', 'vue', 'php', 'dart', 
        'javascriptreact', 'go', 'css', 'cpp', 'html', 'scss', 'markdown', 'csharp', 
        'java', 'json', 'rust', 'ruby', 'c',
    ]

    def __init__(self, weights, intercept):
        self.weights = weights
        self.intercept = intercept

    @classmethod
    def character_map(cls, char) -> list:
        ''' Converts a character code (32-127) to one-hot vector '''
        char_code = ord(char)
        return [1 if char_code == i else 0 for i in range(32, 127)]

    @classmethod 
    def lang_map(cls, query_lang) -> list:
        ''' Converts a supported language to one-hot vector '''
        return [1 if query_lang == lang else 0 for lang in cls.SUPPORTED_LANGS]

    def _preprocess(self, X: dict) -> np.array: 
        ''' Preprocess a query into a vector of features '''

        document_length = len(X['prefix']) + len(X['suffix'])
        offset = len(X['prefix'])
        offset_percentage = offset / document_length
        whitespace_after_cursor = 1 if (len(X['suffix']) >= 1 and X['suffix'][0] == ' ') else 0
        last_prefix_line = X['prefix'].split('\n')[-1]
        last_prefix_line_stripped = last_prefix_line.rstrip()

        return np.array([
            math.log(1 + X['time_since_last_completion']),
            math.log(1 + document_length),
            math.log(1 + offset),
            offset_percentage,
            *self.lang_map(X['language']),
            whitespace_after_cursor,
            math.log(1 + len(last_prefix_line)),
            math.log(1 + len(last_prefix_line_stripped)),
            *self.character_map(last_prefix_line[-1] if len(last_prefix_line) > 0 else chr(0)),
            *self.character_map(last_prefix_line_stripped[-1] if len(last_prefix_line_stripped) > 0 else chr(0)),
        ])

    def predict(self, X: dict) -> bool: 
        X = self._preprocess(X)
        should_filter = X @ self.weights + self.intercept > 0  # True means positive class
        # important to wrap this in bool for json serialisation!
        return not bool(should_filter) # True means to filter out

def get_nontextual_features(query) -> list:
    ''' Get the features that could otherwise not be extracted from the context alone '''

    offset = len(query['prefix'])
    document_length = offset + len(query['suffix'])

    return [
        1 if query['ide'] == 'jetbrains' else 0,           
        1 if query['ide'] == 'vsc' else 0,                 
        math.log(1 + query['time_since_last_completion']), 
        math.log(1 + document_length),      
        math.log(1 + offset),               
        offset / document_length,           
        *Logres.lang_map(query['language']),  
    ]

def tokenize_joint_sample(sample, max_suffix_tokens=128):
    ''' For a single sample, tokenize prefix and suffix, separating by </s> sep token. 
    Set max_suffix_tokens to maximal amount of suffix to include, when it exists. '''

    max_length = tokenizer.model_max_length # 512 

    # figure out how many suffix tokens we have (128 max)
    tokenizer.truncation_side = 'right'
    suffix = tokenizer(sample['suffix'], padding='do_not_pad', truncation=True, return_tensors='pt',
                        max_length = max_suffix_tokens + 1) # to accomodate removal of <s>

    n_suffix_tokens = len(suffix['input_ids'][0]) - 1

    tokenizer.truncation_side = 'left'
    prefix = tokenizer(sample['prefix'], padding='do_not_pad', truncation=True, return_tensors='pt',
                    max_length = max_length - n_suffix_tokens)

    n_prefix_tokens = len(prefix['input_ids'][0])
    tokenizer.truncation_side = 'right'
    suffix = tokenizer(sample['suffix'], padding='max_length', truncation=True, return_tensors='pt',
                    max_length = max_length - n_prefix_tokens + 1) # to accomodate removal of <s>
    
    suffix['input_ids'] = suffix['input_ids'][:, 1:]
    suffix['attention_mask'] = suffix['attention_mask'][:, 1:]

    sample.update({k: torch.cat((prefix[k], suffix[k]), dim=1) for k in prefix})
    return sample


class MyPipeline(TextClassificationPipeline):
    ''' oh yeah custom pipeline because of the custom tokenisation!
        how convenient huggingface ill hug your face extra hard next time i see you '''

    def __init__(self, *args, incl_features=True, preprocess_fn=tokenize_joint_sample, model_name=None, **kwargs):
        if 'device' in kwargs and 'model' in kwargs: 
            print(f'\tusing device \033[1m{kwargs["device"]}\033[0m for model \033[1m{model_name}\033[0m')
        super().__init__(*args, **kwargs)
        self.incl_features = incl_features
        self.preprocess_fn = preprocess_fn

    def _sanitize_parameters(self, **kwargs):
        preprocess_kwargs = {} 
        if 'preprocess_fn' in kwargs: 
            preprocess_kwargs['preprocess_fn'] = kwargs.pop('preprocess_fn')
        return preprocess_kwargs, {}, {} 
    
    def preprocess(self, inputs, preprocess_fn=None):
        inputs = {
            'prefix': inputs['prefix'], 
            'suffix': inputs['suffix'], 
            'encoder_hidden_states': get_nontextual_features(inputs)
        }
        inputs = preprocess_fn(inputs) if self.preprocess_fn is None else self.preprocess_fn(inputs)
        if 'prefix' in inputs: del inputs['prefix']
        if 'suffix' in inputs: del inputs['suffix']
        # given that pipeline is used in sequential eval, we neeed to add a batch dimension for the model to not throw a tantrum
        if self.incl_features:
            inputs['encoder_hidden_states'] = torch.tensor(inputs['encoder_hidden_states'], dtype=torch.float32).unsqueeze(0)
        elif 'encoder_hidden_states' in inputs: 
            del inputs['encoder_hidden_states']
        return inputs

    def _forward(self, model_inputs):
        return self.model(**model_inputs)

    def postprocess(self, model_outputs) -> bool:
        prediction = model_outputs.logits.argmax(-1).item() == 1 # 1 is the positive class
        return not bool(prediction) # True means to filter out

def get_model(model_name):
    model_dir = os.path.join(MODELS_DIR, model_name)
    config = AutoConfig.from_pretrained(model_dir)

    model = JonbertaForSequenceClassification(config)
    if hasattr(config, 'add_head') and config.add_head: 
        add_features_to_model(model, config)

    # ah yes huggingface is a 5 BILLION dollar company now
    state_dict = {} 
    with safe_open(os.path.join(model_dir, 'model.safetensors'), framework='pt') as f: 
        for key in f.keys():
            state_dict[key] = f.get_tensor(key)
    new_layers = model.load_state_dict(state_dict, strict=False)
    print(f'''incompatible keys during loading: {new_layers}. 
          I don\'t know why this happens, I can't reproduce it locally 
          As long as it's just embedding position ids, it should be fine.''') 

    return model 

class Filter(enum.Enum):
    NO_FILTER = 'no_filter'
    FEATURE = 'feature'
    CONTEXT = 'context'
    JOINT_H = 'joint_h'
    JOINT_A = 'joint_a'

no_filter = lambda request_json: True 
logres = Logres(coef, intercept)
set_all_seeds() # just in case 
context_filter = MyPipeline( device=DEVICE, task='text-classification',
                    model=get_model('12_codeberta-biased-2e-05lr--0'), incl_features=True,
                    model_name='12_codeberta-biased-2e-05lr--0' )
set_all_seeds()
joint_h_filter = MyPipeline( device=DEVICE, task='text-classification',
                    model=get_model('-13_jonberta-biased-12_codeberta-biased-2e-05lr--0-(HEAD-dense--reinit)-2e-05lr-1'), incl_features=True,
                    model_name='-13_jonberta-biased-12_codeberta-biased-2e-05lr--0-(HEAD-dense--reinit)-2e-05lr-1' )
set_all_seeds()
joint_a_filter = MyPipeline( device=DEVICE, task='text-classification',
                    model=get_model('13_jonberta-biased-12_codeberta-biased-2e-05lr--0-(ATTN-208C_f-[0]L)-2e-05lr--4'), incl_features=True,
                    model_name='13_jonberta-biased-12_codeberta-biased-2e-05lr--0-(ATTN-208C_f-[0]L)-2e-05lr--4' )

filters = {
    Filter.NO_FILTER: no_filter, 
    Filter.FEATURE: logres.predict,
    Filter.CONTEXT: context_filter,
    Filter.JOINT_H: joint_h_filter,
    Filter.JOINT_A: joint_a_filter,
}
