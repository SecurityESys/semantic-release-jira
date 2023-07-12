import type { Version3, Version3Client } from 'jira.js'
import type { Sprint } from 'jira.js/out/agile/models'
import type { CreateVersion } from 'jira.js/out/version3/parameters'
import * as _ from 'lodash'
import pLimit from 'p-limit'

import { makeAgileClient, makeVersion3Client } from './jira'
import { DEFAULT_RELEASE_DESCRIPTION_TEMPLATE, DEFAULT_VERSION_TEMPLATE } from './types'
import type { GenerateNotesContext, PluginConfig } from './types'
import { escapeRegExp } from './util'

export function getTickets (config: PluginConfig, context: GenerateNotesContext): string[] {
  let patterns: RegExp[] = []

  if (config.ticketRegex != null) {
    patterns = [new RegExp(config.ticketRegex, 'giu')]
  } else if (config.ticketPrefixes != null) {
    patterns = config.ticketPrefixes
      .map(prefix => new RegExp(`\\b${escapeRegExp(prefix)}-(\\d+)\\b`, 'giu'))
  } else {
    context.logger.error('No config.ticketRegex or config.ticketPrefixes were provided, failed to find any tickets.')
    return []
  }

  const tickets = new Set<string>()
  for (const commit of context.commits) {
    for (const pattern of patterns) {
      const matches = commit.message.match(pattern)
      if (matches != null) {
        matches.forEach(match => {
          tickets.add(match)
          context.logger.info(`Found ticket ${matches.toString()} in commit: ${commit.commit.short}`)
        })
      }
    }
  }

  return [...tickets]
}

async function findOrCreateVersion (
  config: PluginConfig,
  context: GenerateNotesContext,
  jira: Version3Client,
  project: Version3.Version3Models.Project,
  name: string,
  description: string,
  activeSprint: Sprint | undefined
): Promise<Version3.Version3Models.Version> {
  const remoteVersions = project.versions
  context.logger.info(`Looking for version with name '${name}'`)
  const existing = _.find(remoteVersions, { name })
  if (existing?.id != null) {
    context.logger.info(`Found existing release '${existing.id}'`)
    return existing
  }

  context.logger.info('No existing release found, creating new')

  let newVersion: Version3.Version3Models.Version
  if (config.dryRun) {
    context.logger.info('dry-run: making a fake release')
    newVersion = {
      name,
      id: 'dry_run_id'
    } as any
  } else {
    const preRelease = typeof context.branch !== 'string' && Boolean(context.branch.prerelease)
    const parameters: CreateVersion = {
      name,
      description,
      projectId: project.id as any,
      startDate: activeSprint?.startDate,
      released: config.released ?? !preRelease,
      releaseDate: (config.setReleaseDate ?? false) ? new Date().toISOString() : undefined
    }
    newVersion = await jira.projectVersions.createVersion(parameters)
  }

  if (newVersion.id == null) {
    context.logger.error('Failed to create new version (couldn\'t find ID of new version)')
    return newVersion
  }

  context.logger.info(`Made new release '${newVersion.id}'`)
  return newVersion
}

async function editIssueFixVersions (config: PluginConfig, context: GenerateNotesContext, jira: Version3Client, newVersionNames: string[], releaseVersionIds: Array<string | undefined>, issueKey: string): Promise<void> {
  try {
    context.logger.info(`Adding issue ${issueKey} to '${newVersionNames.toString()}'`)
    if (!config.dryRun) {
      await jira.issues.editIssue({
        issueIdOrKey: issueKey,
        update: {
          fixVersions: releaseVersionIds.map(id => {
            return { add: { id } }
          })
        },
        properties: undefined as any
      })
    }
  } catch (err: any) {
    const allowedStatusCodes = [400, 404]

    if (allowedStatusCodes.includes(err.response?.status ?? 422)) {
      context.logger.warn(`Unable to update issue ${issueKey}. Error body: ${JSON.stringify(err.response?.data ?? 'no data')}`)
      return
    }

    throw err
  }
}

async function findActiveSprint (config: PluginConfig, context: GenerateNotesContext): Promise<Sprint | undefined> {
  if (config.useBoardForActiveSprint == null) {
    return undefined
  }

  const agileClient = makeAgileClient(config, context)
  const boards = await agileClient.board.getAllBoards({ projectKeyOrId: config.projectId })
  const board = boards.values.find(b => b.name === config.useBoardForActiveSprint)
  if (board != null) {
    const sprints = await agileClient.board.getAllSprints({ boardId: board.id })
    const activeSprint = sprints.values.find(s => s.state === 'active')
    return activeSprint
  }

  context.logger.error(`Board ${config.useBoardForActiveSprint} has no active sprint`)
  return undefined
}

function getVersionNames (config: PluginConfig, context: GenerateNotesContext): string[] {
  const templates = config.releaseNameTemplate == null ? [DEFAULT_VERSION_TEMPLATE] : (Array.isArray(config.releaseNameTemplate) ? config.releaseNameTemplate : [config.releaseNameTemplate])
  return templates.map(template => {
    // Parse the version into its components
    const [version, channel] = context.nextRelease.version.split('-')
    const [major, minor, patch] = version.split('.').map(Number)

    return _.template(template)({
      version: context.nextRelease.version,
      env: context.env,
      major,
      minor,
      patch,
      channel
    })
  })
}

export async function success (config: PluginConfig, context: GenerateNotesContext): Promise<void> {
  const isPrerelease = typeof context.branch !== 'string' && Boolean(context.branch.prerelease)
  const runOnPrerelease = config.runOnPrerelease === undefined || config.runOnPrerelease

  if (!isPrerelease || (isPrerelease && runOnPrerelease)) {
    const tickets = getTickets(config, context)

    context.logger.info(`Found ticket ${tickets.join(', ')}`)

    const versionNames = getVersionNames(config, context)

    const descriptionTemplate = _.template(config.releaseDescriptionTemplate ?? DEFAULT_RELEASE_DESCRIPTION_TEMPLATE)
    const newVersionDescription = descriptionTemplate({ version: context.nextRelease.version, notes: context.nextRelease.notes, env: context.env })

    context.logger.info(`Using jira release(s) '${versionNames.toString()}'`)

    const version3Client = makeVersion3Client(config, context)
    const project = await version3Client.projects.getProject({ projectIdOrKey: config.projectId })

    const activeSprint = await findActiveSprint(config, context)

    const concurrentLimit = pLimit(config.networkConcurrency ?? 10)

    const releaseVersionsPromises = versionNames.map(async (version: string) => {
      return await concurrentLimit(async () => await findOrCreateVersion(config, context, version3Client, project, version, newVersionDescription, activeSprint))
    })
    const releaseVersions = await Promise.all(releaseVersionsPromises)
    const releaseIds = releaseVersions.map(version => version.id)

    const edits = tickets.map(async issueKey => {
      await concurrentLimit(async () => { await editIssueFixVersions(config, context, version3Client, versionNames, releaseIds, issueKey) })
    })
    await Promise.all(edits)
  } else {
    context.logger.info('Configuration set to not run on prerelease branches')
  }
}
