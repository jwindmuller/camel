var fs = require('fs');
var _  = require('underscore');
var markdownit = require('markdown-it')({
    html: true,
    xhtmlOut: true,
    typographer: true
}).use(require('markdown-it-footnote'));

var metadataMarker = '@@';
var postsRoot = './posts/';
var maxCacheSize = 50;

var CUtils = {
    fileIsPost: function(file) {
        file = file.replace(/\\/g, '/');
        var postRegex = /^(.\/)?posts\/\d{4}\/\d{1,2}\/\d{1,2}\/(\w|-|\+)*(.redirect|.md)?$/;
        return postRegex.test(file);
    },
    dateFromFilePath: function(file) {
        file = file.replace(/\\/g, '/');
        var parts = file.split('/');
        return new Date(parts[1], parts[2] - 1, parts[3]);
    },
    // Parses the metadata in the file
    parseMetadata: function(lines) {
        var retVal = {};

        lines.each(function (line) {
            line = line.replace(metadataMarker, '');
            line = line.compact();
            if (line.has('=')) {
                var firstIndex = line.indexOf('=');
                retVal[line.first(firstIndex)] = line.from(firstIndex + 1);
            }
        });

        // NOTE: Some metadata is added in generateHtmlAndMetadataForFile().

        // Merge with site default metadata
        Object.merge(retVal, global.siteMetadata, false, function(key, targetVal, sourceVal) {
            // Ensure that the file wins over the defaults.
            return targetVal;
        });

        return retVal;
    },
    normalizedFileName: function(file) {
        var retVal = file;
        if (file.startsWith('posts')) {
            retVal = './' + file;
        }

        retVal = retVal.replace('.md', '');

        return retVal;
    },
    // Gets all the lines in a post and separates the metadata from the body
    getLinesFromPost: function(file) {
        file = file.endsWith('.md') ? file : file + '.md';
        var data = fs.readFileSync(file, {encoding: 'UTF8'});

        // Extract the pieces
        var lines    = data.lines();
        var metadata = _.filter(lines, function (line) {
            return line.startsWith(metadataMarker);
        });
        var body     = _.difference(lines, metadata).join('\n');

        return {
            metadata: metadata,
            body: body
        };
    },

    replaceMetadata: function(replacements, haystack) {
        _.keys(replacements).each(function (key) {
            // Ensure that it's a global replacement; non-regex treatment is first-only.
            haystack = haystack.replace(new RegExp(metadataMarker + key + metadataMarker, 'g'), replacements[key]);
        });

        return haystack;
    },
    // Gets the external link for this file. Relative if request is
    // not specified. Absolute if request is specified.
    externalFilenameForFile: function(file, request) {
        file = file.replace(/\\/g, '/');
        var hostname = typeof(request) !== 'undefined' ? request.headers.host : '';

        var retVal = hostname.length ? ('http://' + hostname) : '';
        retVal += file.at(0) === '/' && hostname.length > 0 ? '' : '/';
        retVal += file.replace('.md', '').replace(postsRoot, '').replace(postsRoot.replace('./', ''), '');
        return retVal;
    },

    // Gets the metadata & rendered HTML for this file
    generateHtmlAndMetadataForFile: function(file) {
        var rendered = this.Cache.getRenderedPost(file);

        if (rendered === null) {
            var renderer = this.rendererForFile(file);
            this.Cache.setRenderedPost(file, renderer);
            rendered = this.Cache.getRenderedPost(file);
        }
        return rendered;
    },
    rendererForFile: function(file) {
        var lines = this.getLinesFromPost(file);
        var metadata = this.parseMetadata(lines.metadata);
        metadata.relativeLink = this.externalFilenameForFile(file);
        
        // If this is a post, assume a body class of 'post'.
        if (this.fileIsPost(file)) {
            metadata.BodyClass = 'post';
        }
        
        return {
            metadata     : metadata,
            header       : this.replaceMetadata(metadata, global.headerSource),
            postHeader   : this.replaceMetadata(metadata, global.postHeaderTemplate(metadata)),
            rssFooter    : this.replaceMetadata(metadata, global.rssFooterTemplate(metadata)),
            unwrappedBody: this.replaceMetadata(metadata, markdownit.render(lines.body)),
            html: function () {
                return this.header +
                    this.postHeader +
                    this.unwrappedBody +
                    global.footerSource;
            }
        };
    },
    send404: function(response, file) {
        console.log('404: ' + file);
        response.status(404).send(
            this.generateHtmlAndMetadataForFile('posts/404.md').html()
        );
    }
};
CUtils.Cache = {
    data : {},
    get: function(key) {
        var data = this.data[key];
        if (data === undefined) {
            data = {};
        }
        return data;
    },
    set: function(key, value) {
        this.data[key] = value;
    },
    empty: function() {
        console.log('Emptying the cache.');
        this.data = {};
    },
    setRenderedPost: function(file, postData) {
        //console.log('Adding to cache: ' + normalizedFileName(file));
        var renderedPosts = this.get('RenderedPosts');
        var fileName = CUtils.normalizedFileName(file);
        renderedPosts[fileName] = _.extend({
            file: fileName,
            date: new Date()
        }, postData);

        if (_.size(renderedPosts) > maxCacheSize) {
            var sorted = _.sortBy(renderedPosts, function (post) { return post.date; });
            delete renderedPosts[sorted.first().file];
        }
        this.set('RenderedPosts', renderedPosts);

        //console.log('Cache has ' + JSON.stringify(_.keys(renderedPosts)));
    },
    getRenderedPost: function(file) {
        var renderedPosts = this.get('RenderedPosts');
        var fileName = CUtils.normalizedFileName(file);
        return renderedPosts[fileName] || null;
    }
};

module.exports = CUtils;
