var metadataMarker = '@@';

var _ = require('underscore');
var qfs = require('q-io/fs');
var markdownit = require('markdown-it')({
    html: true,
    xhtmlOut: true,
    typographer: true
}).use(require('markdown-it-footnote'));

var postsRoot = './posts/';
var postsPerPage = 10;

var CCache = require('./caching');
var CUtils = require('./camel_utils');

module.exports = {
    // Gets all the posts, paginated.
    // Goes through the posts, descending date order, and joins
    // days together until there are 10 or more posts. Once 10
    // posts are hit, that's considered a page.
    // Forcing to exactly 10 posts per page seemed artificial, and,
    // frankly, harder.
    paginated: function(completion) {
        this.sortedAndGrouped(function(postsByDay) {
            var pages = [];
            var thisPageDays = [];
            var count = 0;
            postsByDay.each(function (day) {
                count += day.articles.length;
                thisPageDays.push(day);
                // Reset count if need be
                if (count >= postsPerPage) {
                    pages.push({ page: pages.length + 1, days: thisPageDays });
                    thisPageDays = [];
                    count = 0;
                }
            });

            if (thisPageDays.length > 0) {
                pages.push({ page: pages.length + 1, days: thisPageDays});
            }

            completion(pages);
        });
    },
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
        var filters = null;
        var limit   = false;
        if (typeof completion === 'object') {
            filters    = completion.filtering ? completion.filtering : filters;
            limit      = completion.limit ? completion.limit : limit;
            completion = completion.completion;
        }
        var posts = CCache.get('PostsSortedGrouped');
        if (Object.size(posts) !== 0) {
            this.filterAndComplete(posts, filters, limit, completion);
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
                key = new Date(key);
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
            this.filterAndComplete(posts, filters, completion);
        }.bind(this));
    },
    filterAndComplete: function(postsByDay, filters, limit, completion) {
        if (filters != null) {
            postsByDay = _.filter(postsByDay, function(postsForDate) {
                var date = postsForDate.date;
                if (filters.year  && filters.year  != date.getFullYear()) {
                    return false;
                }
                if (filters.month && filters.month != date.getMonth()) {
                    return false;
                }
                if (filters.day   && filters.day   != date.getDate()) {
                    return false;
                }
                return true;
            });
        }
        if (limit) {
            var limited = [];
            
            _.every(postsByDay, function(postsForDate) {
                var posts = postsForDate.articles;
                if (limit < posts.length) {
                    posts = posts.slice(0, limit - 1);
                }
                limited.push( {
                    date: postsForDate.date, 
                    articles: posts
                });
                limit -= posts.length;
                var shouldContinue = limit > 0;
                return shouldContinue;
            });
            postsByDay = limited;
            
        }
        completion(postsByDay);
    },
    // Gets the metadata & rendered HTML for this file
    generateHtmlAndMetadataForFile: function(file) {
        var rendered = CCache.getRenderedPost(file);

        if (rendered === null) {
            var postData = buildArticleObject(file);
            CCache.setRenderedPost(file, postData);
            rendered = CCache.getRenderedPost(file);
        }
        return rendered;
    }
};



function buildArticleObject(file) {
    var lines = CUtils.getLinesFromPost(file);
    var metadata = CUtils.parseMetadata(lines.metadata);
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
