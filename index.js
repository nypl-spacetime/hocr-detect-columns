const R = require('ramda')
const cheerio = require('cheerio')
const stats = require('simple-statistics')
const rbush = require('rbush')
const knn = require('rbush-knn')

const defaultConfig = require('./default-config.json')

const transforms = {
  intArray: (array) => array.map((str) => parseInt(str)),
  stripQuotes: (str) => str.replace(/^"|"$/g, ''),
  parseInt: (str) => parseInt(str),
  parseFloat: (str) => parseFloat(str)
}

const transformProperties = {
  bbox: transforms.intArray,
  baseline: transforms.intArray,
  ppageno: transforms.parseInt,
  image: transforms.stripQuotes,
  file: transforms.stripQuotes,
  x_size: transforms.parseFloat,
  x_descenders: transforms.parseFloat,
  x_ascenders: transforms.parseFloat
}

function titleToProperties (title) {
  return R.fromPairs(title
    .split(';')
    .map(R.trim())
    .map(R.split(' '))
    .map((array) => array.length > 2 ? [array[0], array.slice(1)] : array)
    .map((kv) => transformProperties[kv[0]] ? [kv[0], transformProperties[kv[0]](kv[1])] : kv)
  )
}

function mergeConfig (config) {
  return Object.assign({}, defaultConfig, config)
}

function readHocr (hocr) {
  const $ = cheerio.load(hocr)

  return $('.ocr_page').map((index, page) => {
    const lines = $('.ocr_line', page).map((index, line) => {
      const properties = titleToProperties($(line).attr('title'))

      const text = $(line).text().trim()

      if (text.length) {
        return {
          properties,
          text
        }
      }
    }).get()

    return {
      number: index,
      properties: titleToProperties($(page).attr('title')),
      lines
    }
  }).get()
}

function detectColumns (config, page) {
  const xs = page.lines.map((line) => line.properties.bbox[0])

  // One indent per column, and four clusters for other stuff like page numbers and headings
  const columnCount = config.columnCount
  const clusterCount = columnCount * 2 + 4

  if (xs.length < columnCount * config.minLinesPerColumn || clusterCount >= xs.length) {
    return page
  }

  // Find clusters of x coordinates
  const clusters = stats
    .ckmeans(xs, clusterCount)
    .sort((a, b) => b.length - a.length)

  // columns variable will contain the x coordinates of the columns
  // Find columnCount columns, for each cluster, compute mode of x coordinates
  const columns = Array
    .from(Array(columnCount), (x, i) => i)
    .map((i) => clusters[i])
    .map(stats.mode)

  const characterWidth = config.characterWidth

  const lines = page.lines.map((line) => {
    const lineX = line.properties.bbox[0]

    const inColumn = (columnX) => lineX >= columnX - characterWidth &&
      lineX <= columnX + characterWidth

    let columnIndex
    columns.some((columnX, index) => {
      if (inColumn(columnX)) {
        columnIndex = index
        return true
      }
    })

    return Object.assign(line, {
      columnIndex
    })
  })

  return Object.assign(page, {
    lines,
    columns
  })
}

function computeLinesPerColumn (config, page) {
  const columnLines = page.lines.filter((line) => line.columnIndex !== undefined)

  const linesPerColumn = R.toPairs(R.countBy(R.prop('columnIndex'), columnLines))
    .map((pair) => ({
      columnIndex: parseInt(pair[0]),
      count: pair[1]
    }))
    .sort((a, b) => a.columnIndex - b.columnIndex)
    .map((column) => column.count)

  // TODO: maybe use linesPerColumn.some? It happens that the page has two columns,
  //   but the last column only contains a few lines
  //   Or: require every column except the last to have at least minLinesPerColumn lines?
  return Object.assign(page, {
    linesPerColumn,
    minLinesPerColumn: linesPerColumn.length === config.columnCount &&
      linesPerColumn.every((count) => count > config.minLinesPerColumn)
  })
}

function indexLinePositions (page) {
  const tree = rbush(page.lines.length)
  tree.load(page.lines.map((line, index) => ({
    minX: line.properties.bbox[0],
    minY: line.properties.bbox[1],
    maxX: line.properties.bbox[0],
    maxY: line.properties.bbox[1],
    index
  })))

  return tree
}

function connectIndentedLines (page) {
  if (!page.minLinesPerColumn) {
    return page
  }

  const tree = indexLinePositions(page)

  page.lines.forEach((line, lineIndex) => {
    const lineX = line.properties.bbox[0]
    const lineY = line.properties.bbox[1]

    if (line.columnIndex === undefined) {
      const neighbors = knn(tree, lineX, lineY, 1, (item) => {
        const knnLine = page.lines[item.index]
        const knnLineX = knnLine.properties.bbox[0]
        const knnLineY = knnLine.properties.bbox[1]

        return lineIndex !== item.index && knnLine.columnIndex !== undefined &&
          knnLineX <= lineX && knnLineY <= lineY
      })

      if (neighbors.length) {
        const previousLine = page.lines[neighbors[0].index]

        // TODO: use map in loop, make immutable
        previousLine.nextLineIndex = lineIndex
        line.previousLineIndex = neighbors[0].index
      }
    }
  })

  return page
}

function constructCompleteLines (page) {
  const lines = page.lines.map((line, lineIndex) => {
    if (line.nextLineIndex !== undefined && line.previousLineIndex === undefined) {
      let completeText = ''

      let thisLine = line
      while (thisLine) {
        if (completeText.endsWith('-')) {
          completeText = completeText.substring(0, completeText.length - 1) + thisLine.text
        } else {
          completeText += ` ${thisLine.text}`
        }

        thisLine = page.lines[thisLine.nextLineIndex]
      }

      return Object.assign(line, {
        completeText: completeText.trim()
      })
    } else if (line.nextLineIndex === undefined && line.previousLineIndex === undefined && line.columnIndex !== undefined) {
      return Object.assign(line, {
        completeText: line.text
      })
    } else {
      return line
    }
  })

  return Object.assign(page, {
    lines
  })
}

function detectColumnsAndIndentation (hocr, config) {
  config = mergeConfig(config)

  return readHocr(hocr)
    .map(R.curry(detectColumns)(config))
    .map(R.curry(computeLinesPerColumn)(config))
    .map(connectIndentedLines)
    .map(constructCompleteLines)
}

if (require.main === module) {
  const chalk = require('chalk')
  const fs = require('fs')
  const H = require('highland')
  const minimist = require('minimist')

  const argv = minimist(process.argv.slice(2), {
    alias: {
      m: 'mode'
    },
    default: {
      mode: 'log'
    }
  })

  const modes = [
    'log',
    'json',
    'ndjson',
    'html'
  ]

  if (!argv._ || argv._.length !== 1 || !modes.includes(argv.mode)) {
    const help = [
      'usage: detect-columns <options> /path/to/file.hocr',
      '',
      'Options:',
      '  -m, --mode       Choose between text logging, JSON or NDJSON — default is logging',
      '  -c, --config     Path to configuration file (see default-config.json for example)',
      '  -o, --output     File to write JSON/NDJSON output to — default is stdout',
      '',
      'Possible modes:',
      '  log              Logs output to stdout with very nice colors',
      '  json             Outputs a JSON file',
      '  ndjson           Outputs NDJSON file (less data than JSON, easier to parse)',
      '  html             Outputs HTML visualization'
    ]

    console.log(help.join('\n'))
    process.exit()
  }

  const hocr = fs.readFileSync(argv._[0], 'utf8')

  let config = {}
  if (argv.config) {
    config = JSON.parse(fs.readFileSync(argv.config, 'utf8'))
  }

  const output = argv.output ? fs.createWriteStream(argv.output, 'utf8') : process.stdout

  const pages = detectColumnsAndIndentation(hocr, config)

  const data = {
    config: mergeConfig(config),
    pages
  }

  if (argv.mode === 'log') {
    function logPage (page) {
      console.log(`Page: ${page.number}`)
      const properties = R.toPairs(page.properties).map((pair) => `  ${pair[0]}: ${pair[1]}`).join('\n')
      console.log(chalk.gray(properties))

      console.log('  X coordinates of columns:', page.columns ? page.columns.join(', ') : 'no columns found')
      console.log(`Lines: ${chalk.green('text')} ${chalk.yellow('X coordinate')} ${chalk.blue('column')}`)

      page.lines.forEach((line) => {
        const lineX = line.properties.bbox[0]

        if (line.columnIndex !== undefined) {
          console.log(chalk.green(line.text), chalk.yellow(lineX), chalk.blue(line.columnIndex + 1))

          if (line.nextLineIndex) {
            const nextLine = page.lines[line.nextLineIndex]
            const nextLineX = nextLine.properties.bbox[0]
            console.log(chalk.cyan('↪   '), chalk.green(nextLine.text), chalk.yellow(nextLineX))
          }

          if (line.completeText && line.nextLineIndex) {
            console.log(chalk.cyan('=   '), chalk.gray(line.completeText))
          }
        } else if (line.columnIndex === undefined && line.previousLineIndex === undefined) {
          console.log(chalk.red(line.text), chalk.yellow(lineX))
        }
      })
    }

    pages.forEach(logPage)
  } else if (argv.mode === 'json') {
    output.write(JSON.stringify(data, null, 2) + '\n')
  } else if (argv.mode === 'ndjson') {
    H(pages)
      .map((page) => page.lines
        .filter((line) => line.columnIndex !== undefined || line.previousLineIndex === undefined)
        .map((line) => ({
          pageNum: page.number,
          bbox: line.properties.bbox,
          text: line.completeText || line.text,
          columnIndex: line.columnIndex
        })))
      .flatten()
      .map(JSON.stringify)
      .intersperse('\n')
      .append('\n')
      .pipe(output)
  } else if (argv.mode === 'html') {
    const doT = require('dot')
    const template = fs.readFileSync('visualization.template.html', 'utf8')
    doT.templateSettings.strip = false
    const compiledTemplate = doT.template(template)
    const html = compiledTemplate(data)
    output.write(html + '\n')
  }
}

module.exports = detectColumnsAndIndentation
