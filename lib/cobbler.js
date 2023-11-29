var debug = require('debug')
var fs = require('fs')
var CSON = require('cson')
var jade = require('pug')
var marked = require('marked')
var moment = require('moment')
var puppeteer = require('puppeteer')
var path = require('path')
var traverse = require('traverse')
var url = require('url')
var resumeSchema = require('resume-schema')

module.exports = {
  //
  //  Returns a Promise to be resolved with the metadata at `inputfile`,
  //  parsed as JSON.
  //
  //  This path should be absolute.
  //
  load(inputfile) {
    return new Promise((resolve, reject) => {
      fs.readFile(inputfile, 'utf8', (err, contents) => {
        if (err) return reject(err)

        resolve(contents)
      })
    })
      .then(contents => {
        try {
          return JSON.parse(contents)
        } catch (e) {
          const result = CSON.parse(contents)
          if (result instanceof Error) {
            throw new Error([
              'Failed to parse as either JSON or CSON: ',
              '  ' + inputfile,
              'JSON error message: ',
              '  ' + e.message,
              'CSON error message: ',
              '  ' + result.message,
              `Location: ${result.location.first_line}:${result.location.first_column}`
            ].join('\n\n'))
          } else {
            return result
          }
        }
      })
      .then(data => {
        return new Promise((resolve, reject) => {
          resumeSchema.validate(data, (err, report) => {
            if (err) return reject(err, report)

            resolve(data)
          })
        })
      })
      .then(data => {
        debug('cobbler:load')('Data: %j', data)
        return data
      })
      .catch(err => {
        if (err.errors) {
          throw new Error([err.message].concat(
            err.errors.map(validationError => {
              return validationError.path + ': ' + validationError.message
            })
          ).join('\n'))
        }

        if (err) throw err
      })
  },

  //
  //  Returns a Promise to be resolved once `data` has been pre-processed:
  //
  //  - All `summary` and `highlights` fields will be rendered as Markdown.
  //  - All `website` fields will be converted to URL objects. For
  //    more information, see: https://nodejs.org/api/url.html#url_url_strings_and_url_objects
  //
  preprocess(data) {
    var post = traverse(data).map(function () {
      switch (this.key) {
        case 'summary':
          this.update(marked.parse(this.node))
          break
        case 'highlights':
          this.update(this.node.map((a) => marked.parseInline(a)))
          break
        case 'website':
          this.update(url.parse(this.node))
          break
      }
    })

    debug('cobbler:preprocess')('Processed: %j', post)

    return Promise.resolve(post)
  },

  //
  //  Returns a Promise to be resolved once the template at `inputfile`
  //  is completely rendered with `data`, returning the generated HTML.
  //
  //  Input path should be absolute.
  //
  render(inputfile, data) {
    return new Promise((resolve, reject) => {
      fs.readFile(inputfile, 'utf8', (err, contents) => {
        if (err) return reject(err)

        resolve(contents)
      })
    })
      .then(template => jade.compile(template, {
        filename: 'template.pug',
        basedir: path.resolve(__dirname, '../assets'),
      })(Object.assign(data, {
        moment: moment,
      })))
      .then(output => {
        debug('cobbler:render')('Render output: %s', output)

        return output
      })
  },

  //
  //  Returns a Promise to be resolved once a PDF from `html`
  //  document is written to `outputfile`.
  //
  //  Output path should be absolute.
  //
  async pdf(html, outputfile) {
    if (!path.isAbsolute(outputfile)) {
      return Promise.reject(new Error('Output file must be an absolute path.'))
    }

    const browser = await puppeteer.launch({ headless: 'new' })
    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "domcontentloaded" });

    // Wait until all images and fonts have loaded
    // Courtesy of: https://github.blog/2021-06-22-framework-building-open-graph-images/
    await page.evaluate(async () => {
      const selectors = Array.from(document.querySelectorAll("img"));
      await Promise.all([
        document.fonts.ready,
        ...selectors.map((img) => {
          // Image has already finished loading, let’s see if it worked
          if (img.complete) {
            // Image loaded and has presence
            if (img.naturalHeight !== 0) return;
            // Image failed, so it has no height
            throw new Error(`Image failed to load: ${img.src}`);
          }
          // Image hasn’t loaded yet, added an event listener to know when it does
          return new Promise((resolve, reject) => {
            img.addEventListener("load", resolve);
            img.addEventListener("error", () => {
              reject(new Error(`Error loading image: ${img.src}`));
            });
          });
        }),
      ]);
    });

    await page.pdf({
      printBackground: true,
      format: 'Letter',
      margin: {
        bottom: 0,
        left: 0,
        right: 0,
        top: 0,
      },
      path: outputfile,
    });

    await browser.close();
  },
}
