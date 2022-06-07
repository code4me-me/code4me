def truncate_left_context(context, max_length):
    return context[max(0, len(context) - max_length):]


def truncate_right_context(context, max_length):
    return context[:min(max_length, len(context))]
