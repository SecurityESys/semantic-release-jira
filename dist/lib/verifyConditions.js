"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyConditions = void 0;
const tslib_1 = require("tslib");
/* eslint-disable @typescript-eslint/no-throw-literal */
const error_1 = (0, tslib_1.__importDefault)(require("@semantic-release/error"));
const jira_1 = require("./jira");
async function verifyConditions(config, context) {
    const { networkConcurrency } = config;
    if (typeof config.jiraHost !== 'string') {
        throw new error_1.default('config.jiraHost must be a string');
    }
    if (typeof config.projectId !== 'string') {
        throw new error_1.default('config.projectId must be a string');
    }
    if ((config.ticketPrefixes == null) && (config.ticketRegex == null)) {
        throw new error_1.default('Either config.ticketPrefixes or config.ticketRegex must be passed');
    }
    if ((config.ticketPrefixes != null) && (config.ticketRegex != null)) {
        throw new error_1.default('config.ticketPrefixes and config.ticketRegex cannot be passed at the same time');
    }
    if (config.ticketPrefixes != null) {
        if (!Array.isArray(config.ticketPrefixes)) {
            throw new error_1.default('config.ticketPrefixes must be an array of string');
        }
        for (const prefix of config.ticketPrefixes) {
            if (typeof prefix !== 'string') {
                throw new error_1.default('config.ticketPrefixes must be an array of string');
            }
        }
    }
    if ((config.ticketRegex != null) && typeof config.ticketRegex !== 'string') {
        throw new error_1.default('config.ticketRegex must be an string');
    }
    if (config.releaseNameTemplate != null) {
        if (typeof config.releaseNameTemplate !== 'string' && !Array.isArray(config.releaseNameTemplate)) {
            throw new error_1.default('config.releaseNameTemplate must be a string or a list of strings');
        }
    }
    if (config.releaseDescriptionTemplate != null) {
        if (typeof config.releaseDescriptionTemplate !== 'string') {
            throw new error_1.default('config.releaseDescriptionTemplate must be a string');
        }
    }
    if (config.useBoardForActiveSprint != null) {
        if (typeof config.useBoardForActiveSprint !== 'string') {
            throw new error_1.default('config.useBoardForActiveSprint must be a string');
        }
    }
    if ((networkConcurrency != null) && (typeof networkConcurrency !== 'number' || networkConcurrency < 1)) {
        throw new error_1.default('config.networkConcurrency must be an number greater than 0');
    }
    if ((context.env.JIRA_USERNAME === '') && (context.env.JIRA_PASSWORD === '') && (context.env.JIRA_EMAIL === '') && (context.env.JIRA_API_TOKEN === '') && (context.env.JIRA_AUTH === '')) {
        throw new error_1.default('Either JIRA_USERNAME and JIRA_PASSWORD or JIRA_EMAIL and JIRA_API_TOKEN must be set for basic auth');
    }
    if (((context.env.JIRA_USERNAME === '') && (context.env.JIRA_PASSWORD !== '')) || ((context.env.JIRA_USERNAME !== '') && (context.env.JIRA_PASSWORD === ''))) {
        throw new error_1.default('Both JIRA_USERNAME and JIRA_PASSWORD must be set for basic auth');
    }
    if (((context.env.JIRA_EMAIL === '') && (context.env.JIRA_API_TOKEN !== '')) || ((context.env.JIRA_EMAIL !== '') && (context.env.JIRA_API_TOKEN === ''))) {
        throw new error_1.default('Both JIRA_EMAIL and JIRA_API_TOKEN must be set for basic auth');
    }
    const jira = (0, jira_1.makeVersion3Client)(config, context);
    await jira.projects.getProject({ projectIdOrKey: config.projectId });
}
exports.verifyConditions = verifyConditions;
//# sourceMappingURL=verifyConditions.js.map