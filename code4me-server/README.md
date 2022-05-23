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

### `POST` /api/v1/autocomplete
The autocompletion endpoint.

#### Request headers
```
Content-Type: application/json
```

#### Request body
```
{
  "parts": string[],
  "triggerPoint": string | null,
  "language": string
}
```
- `parts`: an array of strings to autocomplete in between
- `triggerPoint`: the trigger keyword in case a trigger point was used, null otherwise
- `language`: language of the source file

#### Response body
```
{
  "completion": string,
  "completionToken": string
}
```
- `completion`: the suggestion made by the server
- `completionToken`: a token to be used for the `/api/v1/completion` endpoint.

### `POST` /api/v1/completion
The statistics endpoint.
Called after 30 seconds from the client, such that the server can create metrics.

#### Request headers
```
Content-Type: application/json
```

#### Request body
```
{
  "completionToken": string,
  "completion": string,
  "line": string
}
```
- `completionToken`: the token from the response of `/api/v1/autocomplete`
- `completion`: the original completion
- `line`: the current line (partial, from the same offset as the completion)

#### Response body
N/A
