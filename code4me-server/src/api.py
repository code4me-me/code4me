from __future__ import annotations 
import os, time, random, json, uuid, glob, torch 

from enum import Enum
from typing import List, TypedDict
from model import Model, Models
from datetime import datetime
from joblib import Parallel, delayed
from flask import Blueprint, request, Response, redirect
from limiter import limiter

from user_study import (
    filter_request, 
    store_completion_request,
    should_prompt_survey,
)

v1 = Blueprint("v1", __name__)
v2 = Blueprint("v2", __name__)

os.makedirs("data", exist_ok=True)

def authorise(req) -> str: 
    ''' Authorise the request. Raise ValueError if the request is not authorised. '''

    auth = req.authorization.token
    if auth is None:
        raise ValueError("Missing bearer token")
    return auth

def get_predictions(completion_request: dict) -> List[str]: 
    ''' Return a list of predictions. '''

    prefix = completion_request['prefix'].rstrip()
    suffix = completion_request['suffix']

    t0 = datetime.now()
    result = Parallel(n_jobs=-1, prefer='threads')(delayed(model.value(prefix, suffix)) for model in Models)
    time = (datetime.now() - t0).total_seconds() * 1000
    result = {model.name: result for model, result in zip(Models, result)}
    return time, result

@v2.route("/prediction/autocomplete", methods=["POST"])
@limiter.limit("4000/hour")
def autocomplete_v2():

    try:
        # TODO: As we want every request to be authorised, this can be extracted into a decorator
        user_uuid = authorise(request)
        request_json = request.json
        
        filter_time, should_filter = filter_request(user_uuid, request_json)
        predict_time, predictions = None, {} \
            if should_filter and (request_json['trigger'] != 'manual') \
            else get_predictions(request_json)

        verify_token = uuid.uuid4().hex
        prompt_survey = should_prompt_survey(user_uuid)

        store_completion_request(user_uuid, verify_token, {
            **request_json,
            'timestamp': datetime.now().toisoformat(),
            'filter_time': filter_time,
            'should_filter': should_filter,
            'predict_time': predict_time,
            'predictions': predictions,
            'survey': prompt_survey,
            'study_version': '0.0.1'
        })

        return {
            'predictions': predictions,
            'verify_token': verify_token,
            'survey': prompt_survey
        }

    except Exception as e:
        return response({
            "error": str(e)
        }, status=400)


##### NOTE: OLD IMPLEMENTATION KEPT FOR JETBRAINS USERS ####
# (and, those that have turned of auto-update for vsc extensions)

@v1.route("/prediction/autocomplete", methods=["POST"])
@limiter.limit("1000/hour")
def autocomplete():
    user_token, res = authorize_user()
    if res is not None:
        return res

    values, res = get_body_values(
        request.get_json(),
        [
            ("leftContext", str, False),
            ("rightContext", str, False),
            ("triggerPoint", str, True),
            ("language", str, False),
            ("ide", str, False),
            ("keybind", bool, True),
            ("pluginVersion", str, True),
            ("storeContext", bool, True)
        ],
    )
    if res is not None:
        return res

    # remove trailing whitespace from left context - tokens usually include a leading space, so this should improve accuracy
    left_context = values["leftContext"] or ""
    stripped_left_context = left_context.rstrip()
    right_context = values["rightContext"]
    store_context = values.get("storeContext", False) is True

    t_before = datetime.now()
    predictions = {}
    unique_predictions_set = set()

    def predict_model(model: Model) -> List[str]:
        try:
            return model.value[1](stripped_left_context, right_context)
        except torch.cuda.OutOfMemoryError:
            exit(1)

    results = Parallel(n_jobs=os.cpu_count(), prefer="threads")(delayed(predict_model)(model) for model in Model)
    for model, model_predictions in zip(Model, results):
        predictions[model.name] = model_predictions
        unique_predictions_set.update(model_predictions)

    t_after = datetime.now()
    unique_predictions = list(unique_predictions_set)
    random.shuffle(unique_predictions)

    verify_token = uuid.uuid4().hex

    with open(f"data/{user_token}-{verify_token}.json", "w+") as f:
        f.write(json.dumps({
            "completionTimestamp": datetime.now().isoformat(),
            "triggerPoint": values["triggerPoint"],
            "language": values["language"].lower(),
            "ide": values["ide"].lower(),
            "modelPredictions": predictions,
            "predictions": unique_predictions,
            "inferenceTime": (t_after - t_before).total_seconds() * 1000,
            "leftContextLength": len(left_context),
            "rightContextLength": len(right_context),
            "keybind": values["keybind"],
            "pluginVersion": values["pluginVersion"],
            "leftContext": left_context if store_context else None,
            "rightContext": right_context if store_context else None
        }))

    # TODO: disable surveys temporarily, as we are currently looking through >1M files on every request. 
    n_suggestions = len(glob.glob(f"data/{user_token}*.json"))
    survey = n_suggestions >= 100 and n_suggestions % 50 == 0

    return response({
        "predictions": unique_predictions,
        "verifyToken": verify_token,
        "survey": survey
    })


@v1.route("/prediction/verify", methods=["POST"])
@limiter.limit("1000/hour")
def verify():
    user_token, res = authorize_user()
    if res is not None:
        return res

    values, res = get_body_values(
        request.get_json(),
        [
            ("verifyToken", str, False),
            ("chosenPrediction", str, True),
            ("groundTruth", str, False),
        ],
    )
    if res is not None:
        return res

    verify_token = values["verifyToken"]
    file_path = f"data/{user_token}-{verify_token}.json"
    if not os.path.exists(file_path):
        return response({
            "error": "Invalid verify token"
        }, status=400)

    with open(file_path, "r+") as completion_file:
        prediction_data = json.load(completion_file)
        if "groundTruth" in prediction_data:
            return response({
                "error": "Already used verify token"
            }, status=400)

        prediction_data["chosenPrediction"] = values["chosenPrediction"]
        prediction_data["groundTruth"] = values["groundTruth"]

        completion_file.seek(0)
        completion_file.write(json.dumps(prediction_data))
        completion_file.truncate()

    return response({
        "success": True
    })


@v1.route("/survey")
def survey():
    user_id = request.args.get("user_id", default="", type=str)
    return redirect(os.getenv("SURVEY_LINK").replace("{user_id}", user_id), code=302)


def authorize_user():
    authorization = request.headers["Authorization"]
    if not authorization.startswith("Bearer "):
        return None, response({
            "error": "Missing bearer token"
        }, status=401)

    user_token = authorization[len("Bearer "):]
    return user_token, None


def get_body_values(body, keys):
    values = {}
    for key, obj, optional in keys:
        value, res = get_body_value(body, key, obj, optional)
        if res is not None:
            return None, res
        values[key] = value
    return values, None


def get_body_value(body, key, obj, optional=False):
    if not optional and key not in body:
        return None, response({
            "error": f"Missing key '{key}' in request body"
        }, status=400)
    value = body.get(key, None)
    if value is not None and not isinstance(value, obj):
        return None, response({
            "error": f"Key '{key}' is not of type '{obj.__name__}'"
        }, status=400)
    return value, None


def response(body, status=200):
    return Response(json.dumps(body, indent=2), mimetype="application/json", status=status)
