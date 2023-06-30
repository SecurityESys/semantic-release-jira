"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.success = exports.getTickets = void 0;
const tslib_1 = require("tslib");
const _ = (0, tslib_1.__importStar)(require("lodash"));
const p_limit_1 = (0, tslib_1.__importDefault)(require("p-limit"));
const jira_1 = require("./jira");
const types_1 = require("./types");
const util_1 = require("./util");
const axios_1 = require("axios");
function getTickets(config, context) {
    let patterns = [];
    if (config.ticketRegex != null) {
        patterns = [new RegExp(config.ticketRegex, 'giu')];
    }
    else if (config.ticketPrefixes != null) {
        patterns = config.ticketPrefixes
            .map(prefix => new RegExp(`\\b${(0, util_1.escapeRegExp)(prefix)}-(\\d+)\\b`, 'giu'));
    }
    else {
        context.logger.error('No config.ticketRegex or config.ticketPrefixes were provided, failed to find any tickets.');
        return [];
    }
    const tickets = new Set();
    for (const commit of context.commits) {
        for (const pattern of patterns) {
            const matches = commit.message.match(pattern);
            if (matches != null) {
                matches.forEach(match => {
                    tickets.add(match);
                    context.logger.info(`Found ticket ${matches.toString()} in commit: ${commit.commit.short}`);
                });
            }
        }
    }
    return [...tickets];
}
exports.getTickets = getTickets;
async function findOrCreateVersion(config, context, jira, project, name, description, activeSprint) {
    var _a, _b;
    const remoteVersions = project.versions;
    context.logger.info(`Looking for version with name '${name}'`);
    const existing = _.find(remoteVersions, { name });
    if ((existing === null || existing === void 0 ? void 0 : existing.id) != null) {
        context.logger.info(`Found existing release '${existing.id}'`);
        return existing;
    }
    context.logger.info('No existing release found, creating new');
    let newVersion;
    if (config.dryRun) {
        context.logger.info('dry-run: making a fake release');
        newVersion = {
            name,
            id: 'dry_run_id'
        };
    }
    else {
        const preRelease = typeof context.branch !== 'string' && Boolean(context.branch.prerelease);
        const parameters = {
            name,
            description,
            projectId: project.id,
            startDate: activeSprint === null || activeSprint === void 0 ? void 0 : activeSprint.startDate,
            released: (_a = config.released) !== null && _a !== void 0 ? _a : !preRelease,
            releaseDate: ((_b = config.setReleaseDate) !== null && _b !== void 0 ? _b : false) ? new Date().toISOString() : undefined
        };
        newVersion = await jira.projectVersions.createVersion(parameters);
    }
    if (newVersion.id == null) {
        context.logger.error('Failed to create new version (couldn\'t find ID of new version)');
        return newVersion;
    }
    context.logger.info(`Made new release '${newVersion.id}'`);
    return newVersion;
}
async function editIssueFixVersions(config, context, jira, newVersionNames, releaseVersionIds, issueKey) {
    var _a, _b, _c, _d;
    try {
        context.logger.info(`Adding issue ${issueKey} to '${newVersionNames.toString()}'`);
        if (!config.dryRun) {
            await jira.issues.editIssue({
                issueIdOrKey: issueKey,
                update: {
                    fixVersions: releaseVersionIds.map(id => {
                        return { add: { id } };
                    })
                },
                properties: undefined
            });
        }
    }
    catch (err) {
        const allowedStatusCodes = [400, 404];
        if (err instanceof axios_1.AxiosError && allowedStatusCodes.includes((_b = (_a = err.response) === null || _a === void 0 ? void 0 : _a.status) !== null && _b !== void 0 ? _b : 422)) {
            context.logger.warn(`Unable to update issue ${issueKey}. Error body: ${JSON.stringify((_d = (_c = err.response) === null || _c === void 0 ? void 0 : _c.data) !== null && _d !== void 0 ? _d : 'no data')}`);
            return;
        }
        throw err;
    }
}
async function findActiveSprint(config, context) {
    if (config.useBoardForActiveSprint == null) {
        return undefined;
    }
    const agileClient = (0, jira_1.makeAgileClient)(config, context);
    const boards = await agileClient.board.getAllBoards({ projectKeyOrId: config.projectId });
    const board = boards.values.find(b => b.name === config.useBoardForActiveSprint);
    if (board != null) {
        const sprints = await agileClient.board.getAllSprints({ boardId: board.id });
        const activeSprint = sprints.values.find(s => s.state === 'active');
        return activeSprint;
    }
    context.logger.error(`Board ${config.useBoardForActiveSprint} has no active sprint`);
    return undefined;
}
function getVersionNames(config, context) {
    const templates = config.releaseNameTemplate == null ? [types_1.DEFAULT_VERSION_TEMPLATE] : (Array.isArray(config.releaseNameTemplate) ? config.releaseNameTemplate : [config.releaseNameTemplate]);
    return templates.map(template => {
        // Parse the version into its components
        const [version, channel] = context.nextRelease.version.split('-');
        const [major, minor, patch] = version.split('.').map(Number);
        return _.template(template)({
            version: context.nextRelease.version,
            env: context.env,
            major,
            minor,
            patch,
            channel
        });
    });
}
async function success(config, context) {
    var _a, _b;
    const isPrerelease = typeof context.branch !== 'string' && Boolean(context.branch.prerelease);
    const runOnPrerelease = config.runOnPrerelease === undefined || config.runOnPrerelease;
    if (!isPrerelease || (isPrerelease && runOnPrerelease)) {
        const tickets = getTickets(config, context);
        context.logger.info(`Found ticket ${tickets.join(', ')}`);
        const versionNames = getVersionNames(config, context);
        const descriptionTemplate = _.template((_a = config.releaseDescriptionTemplate) !== null && _a !== void 0 ? _a : types_1.DEFAULT_RELEASE_DESCRIPTION_TEMPLATE);
        const newVersionDescription = descriptionTemplate({ version: context.nextRelease.version, notes: context.nextRelease.notes, env: context.env });
        context.logger.info(`Using jira release(s) '${versionNames.toString()}'`);
        const version3Client = (0, jira_1.makeVersion3Client)(config, context);
        const project = await version3Client.projects.getProject({ projectIdOrKey: config.projectId });
        const activeSprint = await findActiveSprint(config, context);
        const concurrentLimit = (0, p_limit_1.default)((_b = config.networkConcurrency) !== null && _b !== void 0 ? _b : 10);
        const releaseVersionsPromises = versionNames.map(async (version) => {
            return await concurrentLimit(async () => await findOrCreateVersion(config, context, version3Client, project, version, newVersionDescription, activeSprint));
        });
        const releaseVersions = await Promise.all(releaseVersionsPromises);
        const releaseIds = releaseVersions.map(version => version.id);
        const edits = tickets.map(async (issueKey) => {
            await concurrentLimit(async () => { await editIssueFixVersions(config, context, version3Client, versionNames, releaseIds, issueKey); });
        });
        await Promise.all(edits);
    }
    else {
        context.logger.info('Configuration set to not run on prerelease branches');
    }
}
exports.success = success;
//# sourceMappingURL=success.js.map