import pg from 'pg'

/**
 * The playground's composition, as a host's Nitro plugin would be. With
 * `PLAYGROUND_DATABASE_URL` set it supplies the database and applies the
 * migrations; nobody is ever signed in. A real host supplies Identity's,
 * Authorisation's and Authentication's adapters too.
 */
export default defineNitroPlugin(async () => {
  provideConfigurationSubjectResolver({ resolve: async () => null })
  provideConfigurationDeployment({ 'site.name': 'Configuration playground', 'seo.title-template': '%s · Configuration playground' })
  const url = process.env.PLAYGROUND_DATABASE_URL
  if (!url) return
  provideConfigurationDatabase({ dialect: 'postgres', pool: new pg.Pool({ connectionString: url }) })
  await migrateConfigurationDatabase()
})
