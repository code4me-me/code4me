import copy
import json
import os
import sys
from test_eval import is_not_valid_data, get_language, add_data, classify_all_scores


if __name__ == '__main__':
    data_folder = '../data'
    directory = os.fsencode(data_folder)
    data_dict = {
        'python': {},
        'java': {},
        'typescript': {},
        'php': {},
        'vue': {},
        'kotlin': {},
        'typescriptreact': {},
        'javascript': {},
        'robotframework': {},
        'json': {},
        'latex': {},
        'html': {},
        'javascriptreact': {},
        'xml': {},
        'go': {},
        'ruby': {},
        'csharp': {},
        'blade.php': {},
        'markdown': {},
        'rust': {},
        'css': {},
        'objectivec': {},
        'cpp': {},
        'dart': {},
        'sql': {},
        'shellscript': {},
        'prisma': {},
        'yaml': {},
        'txt': {},
        'swift': {},
        'c': {},
        'gitignore': {},
        'groovy': {},
        'perl5': {},
        'less': {},
        'scala': {},
        'julia': {},
        'other': {}
    }
    languages = {}
    users = {}
    dates_data = {}
    dates_users = {}

    for k in data_dict.keys():
        data_dict[k] = {
            'incoder': [],
            'unixcoder': []
        }

    for file in os.listdir(directory):
        filename = data_folder + '/' + os.fsdecode(file)
        user = filename.split('-')[0].split('/')[2]

        with open(filename) as json_file:
            try:
                data = json.load(json_file)
            except:
                continue

            # continue if data point invalid
            if is_not_valid_data(data):
                continue

            l = get_language(data['language'])
            if l not in languages:
                languages[l] = 1
            else:
                languages[l] += 1

            if user not in users:
                users[user] = [data]
            else:
                users[user].append(data)

            t = data['completionTimestamp'][:10]
            if t not in dates_data:
                dates_data[t] = 1
            else:
                dates_data[t] += 1

            if t not in dates_users:
                dates_users[t] = [user]
            else:
                if user not in dates_users[t]:
                    dates_users[t].append(user)

    n_languages = -1
    n_days = -1
    n_users = -1
    if len(sys.argv) == 4:
        n_languages = int(sys.argv[1])
        n_days = int(sys.argv[2])
        n_users = int(sys.argv[3])

    prompt_languages = 'ALL languages sorted by total valid data points:'
    sorted_languages = {k: v for k, v in sorted(languages.items(), key=lambda item: item[1], reverse=True)}
    if n_languages > 0:
        sorted_languages = {k: sorted_languages[k] for k in list(sorted_languages.keys())[:n_languages]}
        prompt_languages = f'top {n_languages} languages sorted by total valid data points:'

    print(prompt_languages)
    print(sorted_languages)
    print()

    prompt_dates_data = 'total new valid data points generated ALL TIME:'
    sorted_dates_data = {k: v for k, v in sorted(dates_data.items(), reverse=True)}
    prompt_dates_users = 'amount of unique users using code4me ALL TIME:'
    sorted_dates_users = {k: len(v) for k, v in sorted(dates_users.items(), reverse=True)}
    if n_days > 0:
        sorted_dates_data = {k: sorted_dates_data[k] for k in list(sorted_dates_data.keys())[:n_days]}
        sorted_dates_users = {k: sorted_dates_users[k] for k in list(sorted_dates_users.keys())[:n_days]}
        prompt_dates_data = f'total new valid data points generated in last {n_days} days:'
        prompt_dates_users = f'amount of unique users using code4me in last {n_days} days:'

    print(prompt_dates_data)
    print(sorted_dates_data)
    print()

    print(prompt_dates_users)
    print(sorted_dates_users)
    print()

    prompt_users = 'ALL users sorted by total valid data points:'
    sorted_users = {k: v for k, v in sorted(users.items(), key=lambda item: len(item[1]), reverse=True)}
    if n_users > 0:
        sorted_users = {k: sorted_users[k] for k in list(sorted_users.keys())[:n_users]}
        prompt_users = f'top {n_users} most active users sorted by total valid data points:'

    print(prompt_users)
    for idx, (k, v) in enumerate(sorted_users.items()):
        temp_data_dict = copy.deepcopy(data_dict)
        print(f'--- user #{idx + 1}: {k} ---')
        for x in v:
            add_data(get_language(x['language']), temp_data_dict, x)

        for language in temp_data_dict.keys():
            if len(temp_data_dict[language]['incoder']) + len(temp_data_dict[language]['unixcoder']) > 0:
                ide = '(error no ide found)'
                for y in temp_data_dict[language]['incoder']:
                    if 'ide' in y:
                        ide = y['ide']
                        break

                print(f'------{language} in {ide}')
                classify_all_scores(temp_data_dict[language])

    print('done')
