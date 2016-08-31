'use strict';

const http = require('http');
const url = require('url');
const qs = require('querystring');
const fs = require('fs');
const crypto = require('crypto');
const exec = require('child_process').exec;

const Routing = function (server) {
    var route = {'GET': {}, 'POST': {}};
    this.get = function (name, requestListener) {
        route['GET'][name] = requestListener;
    };
    this.post = function (name, requestListener) {
        route['POST'][name] = requestListener;
    };
    server.on('request', function (req, res) {
        var urlParams = url.parse(req.url, true);
        var urlPathname = urlParams['pathname'];
        var urlQueryParams = urlParams['query'];
        var method = req.method;
        var requestListener = route[method][urlPathname];
        if (typeof requestListener != "function") {
            res.statusCode = 404;
            res.end(`Url path not found: ${urlPathname}`);
            return;
        }
        var requestBuffer = new Buffer([]);
        req.on('data', function (chunk) {
            requestBuffer = Buffer.concat([requestBuffer, chunk]);
        });
        req.on('end', function () {
            var postData = qs.parse(requestBuffer.toString());
            requestListener(req, res, urlQueryParams, postData);
        });
    });
};

const Template = function (layout) {
    var loadTemplate = function (template) {
        return fs.readFileSync(template, 'utf8');
    };
    var tag = /{{([^}]+)}}/;
    var bindParams = function (jst, params) {
        var match;
        while (match = tag.exec(jst)) {
            jst = jst.replace(match[0], params[match[1]]);
        }
        return jst;
    };
    var layoutJst = loadTemplate(layout);
    var bindLayout = function (content) {
        return bindParams(layoutJst, {'content': content});
    };
    this.renderPartial = function (template, params) {
        var jst = loadTemplate(template);
        if (!params) {
            return jst;
        }
        return bindParams(jst, params);
    };
    this.render = function (res, template, params) {
        res.end(bindLayout(this.renderPartial(template, params)));
    };
};

const Mailer = function () {
    this.sendmail = function (email, subject, message) {
        console.log('->', 'sendmail', email, subject, message);
        var cmd = `echo "${message}" | mail -s "${subject}" ${email}`;
        exec(cmd);
    };
};

const Repository = function (filename) {
    try {
        this.items = require(filename);
    } catch (e) {
        throw new SyntaxError(`Load from file ${filename}: ${e.name}, ${e.message}`);
    }
    this.getAll = function () {
        return this.items;
    };
    this.getByEmail = function (email) {
        var item = this.items[email];
        if (!item) {
            throw new Error('Item not found');
        }
        return item;
    };
    this.add = function (email, phone) {
        this.items[email] = phone;
        return this;
    };
    this.save = function () {
        try {
            fs.writeFileSync(filename, JSON.stringify(this.items, null, 2), 'utf8');
        } catch (e) {
            throw new SyntaxError(`Save in file ${filename}: ${e.name}, ${e.message}`);
        }
    };
};

const Encryption = function (repository) {
    this.getAll = function () {
        //use RSA private key
    };
    this.getByEmail = function (email) {
        var emailHash = crypto.createHash('md5').update(email).digest('hex');
        var decipher = crypto.createDecipher('aes-256-ctr', emailHash);
        var phoneEncryption = repository.getByEmail(emailHash)['phone'];
        return decipher.update(phoneEncryption, 'hex', 'utf8') + decipher.final('utf8');
    };
    this.add = function (email, phone) {
        var emailHash = crypto.createHash('md5').update(email).digest('hex');
        var cipher = crypto.createCipher('aes-256-ctr', emailHash);
        var phoneEncryption = cipher.update(phone, 'utf8', 'hex') + cipher.final('hex');
        repository.add(emailHash, {
            'phone': phoneEncryption,
            'data': null //use RSA public key
        });
        return this;
    };
    this.save = function () {
        repository.save();
    }
};

const clientRepository = new Repository('./clients.json');
const clientEncryptionRepository = new Encryption(clientRepository);

const server = http.createServer();
const port = 8081;
const routing = new Routing(server);
const template = new Template('./jst/layout.jst');
const mailer = new Mailer();

routing.get('/', function (req, res) {
    template.render(res, './jst/client-form-add.jst');
});

routing.post('/add', function (req, res, params, post) {
    if (!post['email'] || !post['phone']) {
        return template.render(res, './jst/alert.jst', {
            'class': 'danger',
            'text': 'Please fill out all fields'
        });
    }
    clientEncryptionRepository.add(post['email'], post['phone']);
    clientEncryptionRepository.save();
    template.render(res, './jst/alert.jst', {
        'class': 'success',
        'text': 'Phone number and email added'
    });
});

routing.get('/restore', function (req, res) {
    template.render(res, './jst/client-form-restore.jst');
});

routing.post('/restore', function (req, res, params, post) {
    var email = post['email'];
    if (!email) {
        return template.render(res, './jst/alert.jst', {
            'class': 'danger',
            'text': 'Please fill out all fields'
        });
    }
    try {
        var phone = clientEncryptionRepository.getByEmail(email);
    } catch (e) {
        return template.render(res, './jst/alert.jst', {
            'class': 'danger',
            'text': e.name + ': ' + e.message
        });
    }
    mailer.sendmail(email, 'Restore you phone', `You phone: ${phone}`);
    template.render(res, './jst/alert.jst', {
        'class': 'success',
        'text': 'Phone number sent to the email'
    });
});

server.listen(port);
console.log(`Server running on http://localhost:${port}`);

process.on('SIGINT', function() {
    server.close(function () {
        console.log('Server stop');
        clientEncryptionRepository.save();
        process.exit();
    });
});
