var util = require('util');
var _ = require('underscore');
var fs  = require('fs');
var qfs = require('q-io/fs');


var postsPerPage = 10;


var CUtils = require('./camel_utils');
var CCache = CUtils.Cache;

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

        qfs.listTree(global.postsRoot, function (name, stat) {
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
                        articles.push(CUtils.generateHtmlAndMetadataForFile(file));
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
            this.filterAndComplete(posts, filters, limit, completion);
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

    /*
        Posts list for archives
    */
    // Day view
    yyyyMmDd: function (request, response) {
        var seekingDay = new Date(request.params.year, request.params.month - 1, request.params.day);
        this.sortedAndGrouped(
            {
                filtering: {
                    year : request.params.year,
                    month: request.params.month - 1,
                    day  : request.params.day,
                },
                completion: postListBuilder(request, response,
                    util.format(
                        '<h1>Posts from %s</h1>',
                        seekingDay.format('{Weekday}, {Month} {d}, {yyyy}')
                    ),
                    '', false
                )
            }
        );
    },

    // Month view
    yyyyMm: function (request, response) {
        var seekingDay = new Date(request.params.year, request.params.month - 1);
        this.sortedAndGrouped({
            filtering: {
                year : request.params.year,
                month: request.params.month - 1
            },
            completion: postListBuilder(request, response,
                seekingDay.format('{Month}'),
                '{Weekday}, {Month} {d}', '/{yyyy}/{MM}/{dd}/'
            )
        });
    },

    // Year view
    yyyy: function(request, response) {
        var year = request.params[0];
        this.sortedAndGrouped({
            filtering: {
                year: year
            },
            completion: postListBuilder(request, response,
                year,
                '{Month}', '/{yyyy}/{MM}/'
            )
        });
    },

    /*
        Single post
    */
    single: function (request, response) {
        var file = global.postsRoot + request.params.year + '/' + request.params.month + '/' + request.params.day + '/' + request.params.slug;
        loadAndSendMarkdownFile(file, response);
    },

    staticPage: function (request, response) {
        var file = global.postsRoot + request.params.slug;
        loadAndSendMarkdownFile(file, response);
    },

    sendMarkdownString: function(markdown, response) {
        var lines = CUtils.getLinesFromString(markdown);
        var renderer = CUtils.rendererForLines(lines, lines.metadata);
        var html = renderer.html();
        response.status(200).send(html);
    }
};

function postListBuilder(request, response, title, subTitleFormat, subtitleLinkFormat) {
    return function(postsByDay) {
        var pageContent  = util.format('<h1>%s</h1>', title);
        var lastSubtitle = '';
        var links        = '';
        postsByDay.each(function(day) {
            var subtitle = day.date.format(subTitleFormat);
            if (subtitleLinkFormat) {
                subtitle = util.format('<a href="%s">%s</a>', day.date.format(subtitleLinkFormat), subtitle);
            }
            subtitle = util.format('<h2>%s</h2>', subtitle);

            if (subTitleFormat !== '' && subtitle != lastSubtitle) {
                if (links !== '') {
                    pageContent += util.format('<ul>%s</ul>', links);
                }
                pageContent += subtitle;
                lastSubtitle = subtitle;
                links = '';
            }

            day.articles.each(function (article) {
                links += util.format(
                    '<li><a href="%s">%s</a></li>',
                    article.metadata.relativeLink,
                    article.metadata.Title
                );
            });

            if (subTitleFormat === '') {
                pageContent += util.format('<ul>%s</ul>', links);
                links = '';
            }
 
        });
        if (links !== '') {
            pageContent += util.format('<ul>%s</ul>', links);
        }

        if (postsByDay.length === 0) {
            pageContent += "<i>No posts found.</i>";
        }

         var header = CUtils.replaceMetadata(global.siteMetadata, headerSource).replace(
            global.metadataMarker + 'Title' + global.metadataMarker,
            title + '&mdash;' + siteMetadata.SiteTitle
        );
        response.status(200).send(
            header + pageContent + global.footerSource
        );
    };
}


function loadAndSendMarkdownFile(file, response) {
    if (CCache.getRenderedPost(file) !== null) {
        // Send the cached version.
        console.log('Sending cached file: ' + file);
        response.status(200).send(CCache.getRenderedPost(file).html());
    } else {
        var found = false;
        // Is this a post?
        if (fs.existsSync(file + '.md')) {
            found = true;
            console.log('Sending file: ' + file);
            var html = CUtils.generateHtmlAndMetadataForFile(file).html();
            response.status(200).send(html);
        // Or is this a redirect?
        } else if (fs.existsSync(file + '.redirect')) {
            var data = fs.readFileSync(file + '.redirect', {encoding: 'UTF8'});
            if (data.length > 0) {
                var parts = data.split('\n');
                if (parts.length >= 2) {
                    found = true;
                    console.log('Redirecting to: ' + parts[1]);
                    response.redirect(parseInt(parts[0], 10), parts[1]);
                }
            }
        }

        if (!found) {
            CUtils.send404(response, file);
            return;
        }
    }
}

