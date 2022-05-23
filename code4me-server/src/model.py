from enum import Enum
import incoder


class Model(Enum):
    InCoder = (0, lambda parts: incoder.infill(parts, max_to_generate=64))
    CodeFill = (1, lambda parts: incoder.infill(parts, max_to_generate=64))

    @classmethod
    def _missing_(cls, value):
        if isinstance(value, int):
            for item in cls:
                if item.value[0] == value:
                    return item
        return super()._missing_(value)
