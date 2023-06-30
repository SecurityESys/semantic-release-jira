"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeAgileClient = exports.makeVersion3Client = void 0;
const jira_js_1 = require("jira.js");
function getClientOptions(config, context) {
    const clientOptions = {
        host: config.jiraHost
    };
    if ((context.env.JIRA_USERNAME !== '') && (context.env.JIRA_PASSWORD !== '')) {
        clientOptions.authentication = {
            basic: {
                username: context.env.USERNAME,
                password: context.env.PASSWORD
            }
        };
    }
    if ((context.env.JIRA_EMAIL !== '') && (context.env.JIRA_API_TOKEN !== '')) {
        clientOptions.authentication = {
            basic: {
                email: context.env.JIRA_EMAIL,
                apiToken: context.env.JIRA_API_TOKEN
            }
        };
    }
    // This is for backwards compatibility
    if (context.env.JIRA_AUTH !== '') {
        const decoded = Buffer.from(context.env.JIRA_AUTH, 'base64').toString('utf-8');
        const username = decoded.split(':')[0];
        const password = decoded.split(':')[1];
        clientOptions.authentication = {
            basic: {
                username,
                password
            }
        };
    }
    return clientOptions;
}
function makeVersion3Client(config, context) {
    return new jira_js_1.Version3Client(getClientOptions(config, context));
}
exports.makeVersion3Client = makeVersion3Client;
function makeAgileClient(config, context) {
    return new jira_js_1.AgileClient(getClientOptions(config, context));
}
exports.makeAgileClient = makeAgileClient;
//# sourceMappingURL=jira.js.map