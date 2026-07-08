import { S3 } from 'aws-sdk'
import { env } from '../config/env'
import { logger } from '../lib/logger'

let client: S3 | undefined
const s3 = (): S3 => {
  if (!client) {
    const { accessKeyId, secretAccessKey, region } = env.aws()
    client = new S3({ accessKeyId, secretAccessKey, region })
  }
  return client
}

const putHtml = (key: string, body: string): Promise<unknown> =>
  s3()
    .putObject({
      Bucket: env.demoBucket,
      Key: key,
      Body: body,
      ContentType: 'text/html'
    })
    .promise()

/* Uploads the primary and secondary demo pages to the demo bucket at
 * {companyId}/index.html and {companyId}/secondary/index.html. Returns the
 * public demo URL. */
export const uploadDemo = async (
  companyId: string,
  html: { primary: string; secondary: string }
): Promise<string> => {
  await Promise.all([
    putHtml(`${companyId}/index.html`, html.primary),
    putHtml(`${companyId}/secondary/index.html`, html.secondary)
  ])

  const demoUrl = `${env.demoBaseUrl}/${companyId}/`
  logger.info(`Uploaded demo to ${demoUrl}`)
  return demoUrl
}
