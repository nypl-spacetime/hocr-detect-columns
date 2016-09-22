# hocr-detect-columns

Detects columns and indented lines in an [hOCR file](https://en.wikipedia.org/wiki/HOCR). This Python 3 script is used in the NYPL's [NYC Space/Time Directory](http://spacetime.nypl.org/) project to extract data from digitized city directories.

![hOCR column detection](animation.gif)

Most OCR tools can produce hOCR files — we are using [OCRopus](https://github.com/tmbdev/ocropy). See https://github.com/nypl-spacetime/ocr-scripts for more details.

## Installation

`hocr-detect-columns` was built and tested using Python 3.5, and depends on the following packages:

- [NumPy](http://www.numpy.org/)
- [Pillow](https://python-pillow.org/)
- [Jinja2](http://jinja.pocoo.org/)

## Usage

    python3 detect_columns.py /path/to/hocr.html

`hocr-detect-columns` will parse `hocr.html` and create three files in `path/to`:

  - `bboxes.json`
  - `lines.txt`
  - `visualization.html`

## How does it work?

COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON! COMING SOON!
