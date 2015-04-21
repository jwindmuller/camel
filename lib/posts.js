var metadataMarker = '@@';
var siteMetadata = {};

var _ = require('underscore');
var qfs = require('q-io/fs');
var markdownit = require('markdown-it')({
    html: true,
    xhtmlOut: true,
    typographer: true
}).use(require('markdown-it-footnote'));

var postsRoot = './posts/';

var CCache = require('./caching');
var CUtils = require('./camel_utils');

module.exports = {

    // Gets all the posts, grouped by day and sorted descending.
    // Completion handler gets called with an array of objects.
    // Array
    //   +-- Object
    //   |     +-- 'date' => Date for these articles
    //   |     `-- 'articles' => Array
    //   |            +-- (Article Object)
    //   |            +-- ...
    //   |            `-- (Article Object)
    //   + ...
    //   |
    //   `-- Object
    //         +-- 'date' => Date for these articles
    //         `-- 'articles' => Array
    //                +-- (Article Object)
    //                +-- ...
    //                `-- (Article Object)
    sortedAndGrouped: function(completion) {
        var posts = CCache.get('PostsSortedGrouped');
        if (Object.size(posts) !== 0) {
            completion(posts);
            return;
        }

        qfs.listTree(postsRoot, function (name, stat) {
            return CUtils.fileIsPost(name);
        }).then(function (files) {
            // Lump the posts together by day
            var groupedFiles = _.groupBy(files, function (file) {
                return CUtils.dateFromFilePath(file);
            });

            // Sort the days from newest to oldest
            var posts = [];
            var sortedKeys = _.sortBy(_.keys(groupedFiles), function (date) {
                return new Date(date);
            }).reverse();

            // For each day...
            _.each(sortedKeys, function (key) {
                // Get all the filenames...
                var articleFiles = groupedFiles[key];
                var articles = [];

                // ...get all the data for that file ...
                _.each(articleFiles, function (file) {
                    if (!file.endsWith('redirect')) {
                        articles.push(this.generateHtmlAndMetadataForFile(file));
                    }
                }.bind(this));

                // ...so we can sort the posts...
                articles = _.sortBy(articles, function (article) {
                    // ...by their post date and TIME.
                    return Date.create(article.metadata.Date);
                }).reverse();
                // Array of objects; each object's key is the date, value
                // is an array of objects
                // In that array of objects, there is a body & metadata.
                // Note if this day only had a redirect, it may have no articles.
                if (articles.length > 0) {
                    posts.push({date: key, articles: articles});
                }
            }.bind(this));

            CCache.set('PostsSortedGrouped', posts);
            completion(posts);
        }.bind(this));
    },
    // Gets the metadata & rendered HTML for this file
    generateHtmlAndMetadataForFile: function(file) {
        var rendered = CCache.getRenderedPost(file);

        if (rendered === null) {
            var postData = buildPostObject(file);
            CCache.setRenderedPost(file, postData);
            rendered = CCache.getRenderedPost(file);
        }
        return rendered;
    }
};



function buildPostObject(file) {
    var lines = CUtils.getLinesFromPost(file);
    var metadata = parseMetadata(lines.metadata);
    metadata.relativeLink = CUtils.externalFilenameForFile(file);
    
    // If this is a post, assume a body class of 'post'.
    if (CUtils.fileIsPost(file)) {
        metadata.BodyClass = 'post';
    }
    
    return {
        metadata     : metadata,
        header       : CUtils.replaceMetadata(metadata, global.headerSource),
        postHeader   : CUtils.replaceMetadata(metadata, global.postHeaderTemplate(metadata)),
        rssFooter    : CUtils.replaceMetadata(metadata, global.rssFooterTemplate(metadata)),
        unwrappedBody: CUtils.replaceMetadata(metadata, markdownit.render(lines.body)),
        html: function () {
            return this.header +
                this.postHeader +
                this.unwrappedBody +
                global.footerSource;
        }
    };
}

function parseMetadata(lines) {
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
    Object.merge(retVal, siteMetadata, false, function(key, targetVal, sourceVal) {
        // Ensure that the file wins over the defaults.
        return targetVal;
    });

    return retVal;
}