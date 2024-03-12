import os, enum, random, json

from dataclasses import dataclass
from datetime import datetime
from typing import Tuple, Callable

# SESSION_TIMEOUT = 1800  # 30 minutes
SESSION_TIMEOUT = 5
MAX_CACHE_SIZE = 30
STUDY_VERSION = '0.0.1'

USER_STUDY_DIR = 'data_aral'
os.makedirs(USER_STUDY_DIR, exist_ok=True)

class Filter(enum.Enum):
    CONTEXT = 'context'
    FEATURE = 'feature'
    JOINT   = 'joint'

filters = {
    Filter.CONTEXT: lambda request_json: 1,
    Filter.FEATURE: lambda request_json: 0,
    Filter.JOINT:   lambda request_json: 0, 
}

# Cache of user_uuid -> (last_access, filter_type)
# which allows us to retrieve the Filter predict function via filters[filter_type]
cache = {}  # We only have like 100 concurrent users at a time, so in-memory it is 


def get_request_filter(user_uuid: str, time: datetime) -> Callable[[dict], bool]: 
    ''' A user is assigned the same filter while in a session, i.e. if it is no longer than 
        30 mins since the last completion. Otherwise, they are assigned a filter at random '''
    
    filter_type = cache[user_uuid][1] \
        if user_uuid in cache and (time - cache[user_uuid][0]).seconds < SESSION_TIMEOUT \
        else random.choice(list(filters.keys()))

    cache[user_uuid] = (time, filter_type)
    if len(cache) > MAX_CACHE_SIZE: prune_cache(time)

    return filters[filter_type]

def prune_cache(time: datetime):
    ''' Prune cache of users with expired sessions, or update MAX_CACHE_SIZE to grow 
        proportionally. I.e. minimise memory while ensuring all users are kept track of '''
    
    global MAX_CACHE_SIZE
    
    for user_uuid, (last_access, _) in cache.items():
        if (time - last_access).seconds > SESSION_TIMEOUT:
            del cache[user_uuid]

    if len(cache) > MAX_CACHE_SIZE:
        new_size = len(cache) + MAX_CACHE_SIZE
        print(f'Growing cache to size {new_size}')
        MAX_CACHE_SIZE = new_size 
    elif len(cache) < MAX_CACHE_SIZE // 2:
        new_size = MAX_CACHE_SIZE // 2
        print(f'Shrinking cache to size {new_size}')
        MAX_CACHE_SIZE = new_size
    else: 
        print(f"Pruned cache to size {len(cache)}")

def filter_request(user_uuid: str, completion_request: dict) -> Tuple[float, bool]:
    ''' Call the request filter (point of this study), returning the time taken and 
        whether the request should be filtered. '''

    t0 = datetime.now()
    filter_fn = get_request_filter(user_uuid, t0)
    should_filter = filter_fn(completion_request)
    time = (datetime.now() - t0).total_seconds() * 1000

    return time, should_filter

def store_completion_request(user_uuid: str, verify_token: str, completion_request: dict):
    ''' Store the completion request in USER_STUDY_DIR/user_uuid/verify_token.json '''

    user_dir = os.path.join(USER_STUDY_DIR, user_uuid)
    json_file = f'{verify_token}.json'
    os.makedirs(user_dir, exist_ok=True)

    with open(os.path.join(user_dir, json_file), 'w') as f:
        f.write(json.dumps(completion_request))

def should_prompt_survey(user_uuid: str):
    ''' Return whether to prompt the user with survey. I re-specify it here, 
        as it depends on `USER_STUDY_DIR` '''

    user_dir = os.path.join(USER_STUDY_DIR, user_uuid)
    if not os.path.exists(user_dir): return False

    n_suggestions = len(os.listdir(user_dir))
    return n_suggestions >= 100 and n_suggestions % 50 == 0