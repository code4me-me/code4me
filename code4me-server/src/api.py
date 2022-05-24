import json
import os
import uuid
from datetime import datetime

from flask import Blueprint, request, Response

import incoder
import evaluation
from limiter import limiter
from model import Model

v1 = Blueprint("v1", __name__)

os.makedirs("data", exist_ok=True)


@v1.route("/autocomplete", methods=["POST"])
@limiter.limit("600/hour")
def autocomplete():
    user_token, model, res = get_model()
    if res is not None:
        return res

    body = request.get_json()
    if "parts" not in body or len(body["parts"]) == 0:
        return response({
            "error": "No parts specified"
        }, status=400)

    parts = body["parts"]
    parts[-1] += "<|/ file |>"

    t_before = datetime.now()
    code_completion = incoder.infill(parts, max_to_generate=64)
    t_after = datetime.now()
    completion_token = uuid.uuid4().hex

    with open(f"data/{user_token}-{completion_token}.json", "w+") as f:
        f.write(json.dumps({
            "completionTimestamp": datetime.now().isoformat(),
            "triggerPoint": body.get("triggerPoint", None),
            "language": body["language"].lower(),
            "ide": body["ide"].lower(),
            "inferenceTime": (t_after - t_before).total_seconds() * 1000
        }))

    return response({
        "completion": code_completion,
        "completionToken": completion_token
    })


@v1.route("/completion", methods=["POST"])
@limiter.limit("600/hour")
def completion():
    user_token, model, res = get_model()
    if res is not None:
        return res

    completion_data = request.get_json()
    if len(completion_data) == 0:
        return response({
            "error": "No completion specified"
        }, status=400)

    completion_token = completion_data["completionToken"]
    file_path = f"data/{user_token}-{completion_token}.json"
    if not os.path.exists(file_path):
        return response({
            "error": "Invalid completion token"
        }, status=400)

    with open(file_path, "r+") as completion_file:
        user_completion_data = json.load(completion_file)
        if "statisticTimestamp" in user_completion_data:
            return response({
                "error": "Already used completion token"
            }, status=400)

        user_completion_data["evaluation"] = evaluation.compute(
            completion_data["line"],
            completion_data["completion"]
        )

        completion_file.seek(0)
        completion_file.write(json.dumps(user_completion_data))
        completion_file.truncate()

    return response({
        "success": True
    })


def get_model():
    authorization = request.headers["Authorization"]
    if not authorization.startswith("Bearer "):
        return None, None, response({
            "error": "Missing bearer token"
        }, status=401)

    user_token = authorization[len("Bearer "):]
    n = int(user_token, 16)
    return user_token, Model(n % len(Model)), None


def response(body, status=200):
    return Response(json.dumps(body, indent=2), mimetype="application/json", status=status)
