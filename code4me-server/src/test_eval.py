import json
import os
import evaluation
from evaluation import tokenize_code


def print_scores(scores):
    size = len(scores)
    result = [0, 0, 0, 0, 0, 0, 0]
    for item in scores:
        result[0] += item['bleu']
        result[1] += item['exactMatch']
        result[2] += item['levenshtein']
        result[3] += item['meteor']
        result[4] += item['rouge']['precision']
        result[5] += item['rouge']['recall']
        result[6] += item['rouge']['f1measure']

    print("n = ", size)
    print("bleu = ", result[0] / size)
    print("exactMatch = ", result[1] / size)
    print("levenshtein = ", result[2] / size)
    print("meteor = ", result[3] / size)
    print("rouge (precision) = ", result[4] / size)
    print("rouge (recall) = ", result[5] / size)
    print("rouge (f1measure) =", result[6] / size)
    print()


def is_not_valid_data(d):
    return 'groundTruth' not in d or ('groundTruth' in d and d['groundTruth'].strip() == '') or d['predictions'] == ['']


def get_prediction(d):
    if d['chosenPrediction'] is not None:
        p = d['chosenPrediction']
    else:
        p = d['predictions'][0]
    return p.strip()


def classify_scores(model_data, model_scores):
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

    print("inf time = ", sum(inf_time) / len(inf_time))
    print_scores(model_scores)

    print("chosen:")
    print_scores(chosen)

    print("not chosen:")
    print_scores(not_chosen)

    for i in range(1, 11):
        if str(i) in token_length:
            print('token length of prediction = ', i)
            print_scores(token_length[str(i)])
            del token_length[str(i)]
    print('token length of prediction > 10')
    print_scores(sum(token_length.values(), []))

    print("trigger points:")
    print("manual triggers")
    print_scores(trigger_points[None])
    del trigger_points[None]
    sorted_trigger_points = sorted(trigger_points.items(), key=lambda x: len(x[1]), reverse=True)
    for index, (tp, tp_scores) in enumerate(sorted_trigger_points):
        if index >= 10:
            break
        print(tp)
        print_scores(tp_scores)


if __name__ == '__main__':
    data_folder = '../data_10_7_2022'
    directory = os.fsencode(data_folder)
    incoder = []
    incoder_scores = []
    unixcoder = []
    unixcoder_scores = []
    chosen = []
    not_chosen = []
    trigger_points = {}
    inf_time = []
    token_length = {}
    languages = {}
    context_length = 0
    data_points = 0
    valid_data = 0
    ide = {}

    for file in os.listdir(directory):
        filename = data_folder + '/' + os.fsdecode(file)
        user = filename.split('-')[0].split('/')[2]

        with open(filename) as json_file:
            try:
                data = json.load(json_file)
            except:
                continue

            data_points += 1
            # continue if data point invalid
            if is_not_valid_data(data):
                continue
            valid_data += 1

            if data['language'] not in languages:
                languages[data['language']] = 1
            else:
                languages[data['language']] += 1

            if 'leftContextLength' in data and data['leftContextLength'] is not None:
                context_length += 1

            if 'pluginVersion' in data:
                pv = data['pluginVersion']
                if pv is None:
                    pv = 'not_updated'

                if data['ide'] + '_' + pv not in ide:
                    ide[data['ide'] + '_' + pv] = 1
                else:
                    ide[data['ide'] + '_' + pv] += 1
            else:
                if data['ide'] + '_old' not in ide:
                    ide[data['ide'] + '_old'] = 1
                else:
                    ide[data['ide'] + '_old'] += 1

            # check if language is valid for study
            if data['language'] == 'python':

                # add data to correct model
                if data['model'] == 'InCoder' or data['model'] == 'CodeFill':
                    incoder.append(data)
                else:
                    unixcoder.append(data)

    print('data', data_points)
    print('valid_data', valid_data)
    print('context_length_data', context_length)
    print(ide)
    # temp = []
    # for k, v in languages.items():
    #     if v < 1000:
    #         temp.append(k)
    #
    # for y in temp:
    #     del languages[y]
    print(languages)


    # print("incoder:")
    # classify_scores(incoder, incoder_scores)
    #
    # # empty arrays and dicts for next model scores
    # chosen = []
    # not_chosen = []
    # trigger_points = {}
    # inf_time = []
    # token_length = {}
    #
    # print("unixcoder:")
    # classify_scores(unixcoder, unixcoder_scores)