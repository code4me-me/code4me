# Code4Me Python Server
This repo contains the python backend for the Code4Me plugin(s).
Below you can find the api specification for the endpoints.

## Base URL
The Base URL for the (currently) deployed server is:
```
https://code4me.me/
```

## Authentication
Each request must contain the following Authorization header:
```
Authorization: Bearer <TOKEN>
```

This token must be created once on the client, as a UUID v4, without dashes.

## /api/v1
The current version of the API.

### `POST` /api/v1/prediction/autocomplete
The autocompletion endpoint.

#### Request headers
```
Content-Type: application/json
```

#### Request body
```
{
  "leftContext": string,
  "rightContext": string,
  "triggerPoint": string | null,
  "language": string,
  "ide": string
}
```
- `leftContext`: the context left of the prediction
- `rightContext`: the context right of the prediction
- `triggerPoint`: the trigger keyword in case a trigger point was used, null otherwise
- `language`: language of the source file
- `ide`: the ide the request was fired from

#### Response body
```
{
  "predictions": string[],
  "verifyToken": string
}
```
- `predictions`: the suggestion(s) made by the server
- `verifyToken`: a token to be used for the `/api/v1/prediction/verify` endpoint.

### `POST` /api/v1/prediction/verify
The verification endpoint.
Called after 30 seconds from the client, such that the server knows the ground truth of the prediction.

#### Request headers
```
Content-Type: application/json
```

#### Request body
```
{
  "verifyToken": string,
  "chosenPrediction": string | null,
  "groundTruth": string
}
```
- `verifyToken`: the token from the response of `/api/v1/prediction/autocomplete`
- `chosenPrediction`: the chosen prediction from the client
- `groundTruth`: the ground truth of the prediction (the line from the same offset as the completion after 30s)

#### Response body
N/A
