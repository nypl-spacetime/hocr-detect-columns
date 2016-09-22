import re

def join_lines(parts):
    line = ''

    for part in parts:
        if part.endswith('-'):
            line += re.sub(r'-*$', '', part).strip()
        else:
            line += part.strip() + ' '

    return line.strip()

def filter_lines(lines):
    regexps = [
        '.{20,}', # At least 6 characters long
        '^[A-Z]' # Must start with capital letter
    ]

    return [line for line in lines if all([re.compile(regexp).match(line) != None for regexp in regexps])]

def get_lines(pages):
    lines = []

    for page in pages:
        for bbox in page['bboxes']:
            if not 'previous_bbox' in bbox:
                bbox_lines = [bbox['text']]
                if 'next_bbox' in bbox:
                    next_bbox = bbox
                    while 'next_bbox' in next_bbox:
                        next_bbox = page['bboxes'][next_bbox['next_bbox']]
                        bbox_lines.append(next_bbox['text'])

                lines.append(join_lines(bbox_lines))

    return filter_lines(lines)
