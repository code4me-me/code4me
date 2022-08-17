import copy
import json
import os
import evaluation
import sys
from evaluation import tokenize_code


def print_scores(scores):
    size = len(scores)

    if size == 0:
        print('n = 0')
        print()
        return

    result = [0, 0, 0, 0, 0, 0, 0]
    for item in scores:
        result[0] += item['bleu']
        result[1] += item['exactMatch']
        result[2] += item['levenshtein']
        result[3] += item['meteor']
        result[4] += item['rouge']['precision']
        result[5] += item['rouge']['recall']
        result[6] += item['rouge']['f1measure']

    print('n = ', size)
    print('bleu = ', result[0] / size)
    print('exactMatch = ', result[1] / size)
    print('levenshtein = ', result[2] / size)
    print('meteor = ', result[3] / size)
    print('rouge (precision) = ', result[4] / size)
    print('rouge (recall) = ', result[5] / size)
    print('rouge (f1measure) =', result[6] / size)
    print()


def is_not_valid_data(d):
    return 'groundTruth' not in d or ('groundTruth' in d and d['groundTruth'].strip() == '') or d['predictions'] == ['']


def get_prediction(d):
    if d['chosenPrediction'] is not None:
        p = d['chosenPrediction']
    else:
        p = d['predictions'][0]
    return p.strip()


def classify_scores(model_data):
    chosen = []
    not_chosen = []
    trigger_points = {}
    inf_time = []
    token_length = {}
    model_scores = []
    print_detailed = 'detailed' in sys.argv

    for d in model_data:

        # calculate score
        truth = d['groundTruth'].strip()
        pred = get_prediction(d)
        s = evaluation.compute(truth, pred)

        # add score to correct model set
        model_scores.append(s)

        # add score to corresponding trigger point
        if d['triggerPoint'] not in trigger_points:
            trigger_points[d['triggerPoint']] = [s]
        else:
            trigger_points[d['triggerPoint']].append(s)

        # add score to group based on chosen or not
        if d['chosenPrediction'] is not None:
            chosen.append(s)
        else:
            not_chosen.append(s)

        # add inf time to array
        inf_time.append(d['inferenceTime'])

        # add token length to dictionary
        tokenized_pred = tokenize_code(pred)[0]
        if str(len(tokenized_pred)) not in token_length:
            token_length[str(len(tokenized_pred))] = [s]
        else:
            token_length[str(len(tokenized_pred))].append(s)

    if len(inf_time) > 0:
        print('inf time = ', sum(inf_time) / len(inf_time))
    print_scores(model_scores)

    if print_detailed:
        print('chosen:')
        print_scores(chosen)

        print('not chosen:')
        print_scores(not_chosen)

        for i in range(1, 11):
            if str(i) in token_length:
                print('token length of prediction = ', i)
                print_scores(token_length[str(i)])
                del token_length[str(i)]
        print('token length of prediction > 10')
        print_scores(sum(token_length.values(), []))

        print('trigger points:')
        print('manual triggers')
        if None in trigger_points:
            print_scores(trigger_points[None])
            del trigger_points[None]
        else:
            print('n = 0')
            print()
        sorted_trigger_points = sorted(trigger_points.items(), key=lambda x: len(x[1]), reverse=True)
        for index, (tp, tp_scores) in enumerate(sorted_trigger_points):
            if index >= 10:
                break
            print(tp)
            print_scores(tp_scores)


def classify_all_scores(language_dict):
    print('incoder:')
    classify_scores(language_dict['incoder'])

    print('unixcoder:')
    classify_scores(language_dict['unixcoder'])


def add_data(language_key, d, data):
    incoder_list = d[language_key]['incoder']
    unixcoder_list = d[language_key]['unixcoder']

    if 'modelPredictions' in data:
        incoder_prediction = data['modelPredictions']['InCoder'][0]
        unixcoder_prediction = data['modelPredictions']['UniXCoder'][0]
        incoder_data = copy.deepcopy(data)
        unixcoder_data = copy.deepcopy(data)

        if data['chosenPrediction'] is not None:
            if data['chosenPrediction'] != incoder_prediction:
                incoder_data['chosenPrediction'] = None
            if data['chosenPrediction'] != unixcoder_prediction:
                unixcoder_data['chosenPrediction'] = None

        if incoder_prediction != unixcoder_prediction:
            incoder_data['predictions'] = [incoder_prediction]
            unixcoder_data['predictions'] = [unixcoder_prediction]

        incoder_data['inferenceTime'] = incoder_data['inferenceTime'] / 2
        unixcoder_data['inferenceTime'] = unixcoder_data['inferenceTime'] / 2

        if not is_not_valid_data(incoder_data):
            incoder_list.append(incoder_data)
        if not is_not_valid_data(unixcoder_data):
            unixcoder_list.append(unixcoder_data)

    elif data['model'] == 'InCoder' or data['model'] == 'CodeFill':
        incoder_list.append(data)
    else:
        unixcoder_list.append(data)


def get_language(language):
    if language == 'python' or language == '.py' or language == 'py':
        return 'python'
    elif language == 'java' or language == '.java':
        return 'java'
    elif language == 'typescript' or language == '.ts' or language == 'ts':
        return 'typescript'
    elif language == 'php' or language == '.php':
        return 'php'
    elif language == 'vue':
        return 'vue'
    elif language == 'kotlin' or language == 'kt':
        return 'kotlin'
    elif language == 'typescriptreact' or language == '.tsx' or language == 'ts' or language == 'typescript jsx':
        return 'typescriptreact'
    elif language == 'javascript' or language == '.js' or language == 'js' or language == 'ecmascript 6':
        return 'javascript'
    elif language == 'robotframework':
        return 'robotframework'
    elif language == 'json' or language == '.json':
        return 'json'
    elif language == 'latex':
        return 'latex'
    elif language == 'html' or language == '.html':
        return 'html'
    elif language == 'javascriptreact' or language == '.jsx' or language == 'jsx':
        return 'javascriptreact'
    elif language == 'xml' or language == '.xml':
        return 'xml'
    elif language == 'go':
        return 'go'
    elif language == 'ruby':
        return 'ruby'
    elif language == 'csharp' or language == '.cs' or language == 'c#' or language == 'cs':
        return 'csharp'
    elif language == 'blade.php':
        return 'blade.php'
    elif language == 'markdown' or language == '.md' or language == 'md':
        return 'markdown'
    elif language == 'rust' or language == '.rs' or language == 'rs':
        return 'rust'
    elif language == 'css' or language == '.css' or language == 'scss':
        return 'css'
    elif language == 'objectivec':
        return 'objectivec'
    elif language == 'cpp' or language == '.cpp':
        return 'cpp'
    elif language == 'dart' or language == '.dart':
        return 'dart'
    elif language == 'sql' or language == '.sql':
        return 'sql'
    elif language == '.shellscript' or language == '.sh' or language == 'sh' or language == 'shellscript':
        return 'shellscript'
    elif language == 'prisma' or language == '.prisma':
        return 'prisma'
    elif language == 'yaml' or language == '.yaml' or language == 'yml' or language == '.yml':
        return 'yaml'
    elif language == 'txt' or language == '.txt' or language == 'text' or language == 'plaintext':
        return 'txt'
    elif language == 'swift' or language == '.swift':
        return 'swift'
    elif language == 'c' or language == '.c':
        return 'c'
    elif language == 'gitignore':
        return 'gitignore'
    elif language == 'groovy':
        return 'groovy'
    elif language == 'perl5':
        return 'perl5'
    elif language == 'less':
        return 'less'
    elif language == 'scala':
        return 'scala'
    elif language == 'julia':
        return 'julia'
    else:
        return 'other'


if __name__ == '__main__':
    data_folder = '../data_16_08_2022'
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

    for k in data_dict.keys():
        data_dict[k] = {
            'incoder': [],
            'unixcoder': []
        }

    for file in os.listdir(directory):
        filename = data_folder + '/' + os.fsdecode(file)
        # user = filename.split('-')[0].split('/')[2]

        with open(filename) as json_file:
            try:
                data = json.load(json_file)
            except:
                continue

            # continue if data point invalid
            if is_not_valid_data(data):
                continue

            add_data(get_language(data['language']), data_dict, data)

    data_dict = {k: v for k, v in sorted(data_dict.items(), key=lambda item: len(item[1]['incoder']) + len(item[1]['unixcoder']), reverse=True)}
    for k in data_dict.keys():
        print('---', k, '---')
        classify_all_scores(data_dict[k])

    print('done')
