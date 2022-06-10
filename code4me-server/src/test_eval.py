import json
import os
import evaluation


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


if __name__ == '__main__':
    data_folder = '../data3'
    directory = os.fsencode(data_folder)
    incoder = []
    unixcoder = []

    for file in os.listdir(directory):
        filename = data_folder + '/' + os.fsdecode(file)
        user = filename.split('-')[0].split('/')[2]

        with open(filename) as json_file:
            try:
                data = json.load(json_file)
            except:
                continue

            # check if language is valid for study
            if data['language'] == 'python':

                # continue if data point invalid
                if is_not_valid_data(data):
                    continue

                # calculate score
                groundTruth = data['groundTruth'].strip()
                prediction = get_prediction(data)
                score = evaluation.compute(groundTruth, prediction)

                # add score to correct model set
                if data['model'] == 'InCoder' or data['model'] == 'CodeFill':
                    incoder.append(score)
                else:
                    unixcoder.append(score)

    print("incoder:")
    print_scores(incoder)

    print("unixcoder:")
    print_scores(unixcoder)
