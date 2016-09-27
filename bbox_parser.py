from html.parser import HTMLParser

class BboxParser(HTMLParser):
    page_num = -1

    pages = []

    bboxes = None
    last_bbox = None
    file = None

    def read_pages(self, html):
        self.feed(html)
        return self.pages

    def get_attr(self, attrs, attr):
        attr_tuple = list(filter(lambda t: t[0] == attr, attrs))
        if len(attr_tuple) > 0:
            return attr_tuple[0][1]
        else:
            return None

    def has_class(self, attrs, cls):
        attr = self.get_attr(attrs, 'class')
        return attr != None and cls == attr

    def handle_starttag(self, tag, attrs):
        if tag == 'div' and self.has_class(attrs, 'ocr_page'):
            file = self.get_attr(attrs, 'title')

            self.file = file.replace('file ', '')
            self.bboxes = []
            self.page_num = self.page_num + 1
        elif tag == 'span' and self.has_class(attrs, 'ocr_line'):
            bbox = self.get_attr(attrs, 'title')

            if bbox != None:
                bbox = list(map(int, bbox.split()[1:]))
                id = '.'.join([str(i) for i in [self.page_num, bbox[0], bbox[1]]])

                self.last_bbox = {
                    'id': id,
                    'bbox': bbox,
                    'text': ''
                }

    def handle_endtag(self, tag):
        if tag == 'span' and self.last_bbox:
            self.bboxes.append(self.last_bbox)
            self.last_bbox = None

        if tag == 'div' and self.bboxes:
            if (len(self.bboxes)):
                self.pages.append({
                  'page_num': self.page_num,
                  'file': self.file,
                  'bboxes': self.bboxes
                })

            self.bboxes = None
            self.file = None

    def handle_data(self, data):
        if self.last_bbox and len(data.strip()) > 0:
            text = data.strip()

            # Replace escaped ampersand
            text = text.replace('\&', '&')
            self.last_bbox['text'] = text
