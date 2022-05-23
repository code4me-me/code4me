import json
import uuid

if __name__ == '__main__':
    users = {}
    for _ in range(100):
        token = uuid.uuid4().hex
        print(token)

        users[token] = {
            "completions": {}
        }

    with open('users.json', 'w') as users_file:
        json.dump(users, users_file, indent=2)
