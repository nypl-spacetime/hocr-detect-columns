#!/usr/local/bin/python3

import os
import sys
import json
import fnmatch
from pathlib import Path
from PIL import Image
import jinja2
from bbox_parser import BboxParser
import numpy as np

def render(tpl_path, context):
    path, filename = os.path.split(tpl_path)
    return jinja2.Environment(
        loader=jinja2.FileSystemLoader(path or './'),
        extensions=['jinja2.ext.loopcontrols']
    ).get_template(filename).render(context)

if not len(sys.argv) > 1:
    print('Please specify location of an HOCR file')
    sys.exit()

hocr_file = Path(sys.argv[1])
if not hocr_file.is_file():
    print('HOCR file not found:', hocr_file)
    sys.exit()

hocr_dir = os.path.dirname(os.path.abspath(sys.argv[1]))

hocr_html = hocr_file.open().read()
parser = BboxParser()
pages = parser.read_pages(hocr_html)

# Read width & height of each page's image
for page in pages:
    path = page['file']

    if not os.path.isabs(path):
        path = os.path.abspath(os.path.join(hocr_dir, path))

    if Path(path).is_file():
        with Image.open(path) as im:
            width, height = im.size
            page['size'] = [
                width,
                height
            ]


# TODO: make configurable with command line arg
column_count = 2
in_column_bin = .55

histograms = [None] * len(pages)
corrected_pages = [None] * len(pages)

for page_idx, page in enumerate(pages):
    np_bboxes = np.asarray([bbox['bbox'] for bbox in page['bboxes']])
    xys = np_bboxes[:,:2]

    min_x = np.amin(np_bboxes[:,:1])
    max_x = np.amax(np_bboxes[:,:1])

    heights = [bbox[3] - bbox[1] for bbox in np_bboxes]
    avg_height = np.median(heights)

    bin_count = int((max_x - min_x) / avg_height)

    hist, bin_edges = np.histogram(xys[:, 0], bin_count)

    avg_per_bin = np.average(hist)

    bboxes_count = len(np_bboxes)
    detected_column_count = 0
    for count in hist:
        if count > bboxes_count * (in_column_bin / column_count):
            detected_column_count += 1

    print('Page {} - {}:'.format(page['page_num'] + 1, page['file']))

    if detected_column_count != column_count:
        print('  {} {} found - skipping'.format(detected_column_count, 'column' if detected_column_count == 1 else 'columns'))
    else:
        print('  Parsing {} bboxes'.format(len(page['bboxes'])))

        maxima_indices = hist.argsort()[-column_count:][::-1]
        bin_size = bin_edges[1] - bin_edges[0]

        sorted_args = hist.argsort().tolist()
        orders = [len(hist) - sorted_args.index(idx) - 1 for idx in range(len(hist.tolist()))]

        histogram = [{
            'count': count,
            'edges': [bin_edges.tolist()[idx], bin_edges.tolist()[idx + 1]],
            'order': orders[idx],
            'detected_column_count': detected_column_count
        } for idx, count in enumerate(hist.tolist())]

        histograms[page_idx] = histogram

        corrected_bboxes = [None] * len(page['bboxes'])
        corrected_pages[page_idx] = corrected_bboxes

        for bbox_idx, bbox in enumerate(page['bboxes']):
            x = bbox['bbox'][0]
            x_bin_idx = -1

            corrected_bbox = {}

            for idx in range(len(hist.tolist())):
                if x >= bin_edges[idx] and x < bin_edges[idx + 1]:
                    x_bin_idx = idx
                    dxs = [x - (bin_edges[idx] + bin_edges[idx + 1]) / 2 for idx in maxima_indices]
                    min_dx_idx = np.asarray([abs(dx) for dx in dxs]).argmin()

                    dx_pos_close = False
                    dx_pos_far = False
                    if dxs[min_dx_idx] >= 0:
                        if dxs[min_dx_idx] < bin_size:
                            dx_pos_close = True
                        else:
                            dx_pos_far = True

                    # GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER
                    corrected_bbox['corrected_bin_index'] = maxima_indices.tolist()[min_dx_idx]
                    corrected_bbox['corrected_bin_order'] = orders[maxima_indices[min_dx_idx]]

                    bin_middle = (bin_edges[maxima_indices[min_dx_idx]] + bin_edges[maxima_indices[min_dx_idx] + 1]) / 2
                    if idx == maxima_indices[min_dx_idx] or dxs[min_dx_idx] < 0 or dx_pos_close:
                        corrected_bbox['bbox'] = [
                            bin_middle,
                            bbox['bbox'][1],
                            bbox['bbox'][2] + bin_middle - x,
                            bbox['bbox'][3]
                        ]

                    # hier corrected_bbox toevoegen!
                    # GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER
                    # corrected_bboxes[bbox_idx] = corrected_bbox

                    break

            # GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER GUER
            corrected_bbox['text'] = bbox['text']
            corrected_bbox['bin_index'] = x_bin_idx
            corrected_bbox['bin_order'] = orders[x_bin_idx]
            corrected_bboxes[bbox_idx] = corrected_bbox

        for bbox_idx, bbox in enumerate(page['bboxes']):
            corrected_bbox = corrected_bboxes[bbox_idx]
            if 'bbox' not in corrected_bbox and 'corrected_bin_index' in corrected_bbox:
                # TODO: add half line height
                similar_bboxes = []
                for bbox_idx2, bbox2 in enumerate(page['bboxes']):
                    corrected_bbox2 = corrected_bboxes[bbox_idx2]
                    if 'corrected_bin_index' in corrected_bbox2 and corrected_bbox2['corrected_bin_index'] == corrected_bbox['corrected_bin_index'] and bbox2['bbox'][1] > bbox['bbox'][1]:
                        similar_bboxes.append((bbox_idx2, bbox2))

                if len(similar_bboxes) > 0:
                    similar_bboxes.sort(key=lambda t: t[1]['bbox'][1] - bbox['bbox'][1])

                    bbox['previous_bbox'] = similar_bboxes[0][0]
                    page['bboxes'][similar_bboxes[0][0]]['next_bbox'] = bbox_idx

# Remove all pages with the wrong detected column count, and have no histograph data
pages = [page for page_idx, page in enumerate(pages) if histograms[page_idx] != None]

# Write data to files

with open(os.path.join(hocr_dir, 'bboxes.json'), 'w') as outfile:
    outfile.write(json.dumps(pages, indent=2, sort_keys=True))

from get_lines import get_lines
with open(os.path.join(hocr_dir, 'lines.txt'), 'w') as lines_file:
    print('\n'.join(get_lines(pages)), file=lines_file)

html = render('visualization.template.html', {
    'pages': pages,
    'histograms': histograms,
    'corrected_pages': corrected_pages,
    'column_count': column_count
})

with open(os.path.join(hocr_dir, 'visualization.html'), 'w') as html_file:
    print(html, file=html_file)
