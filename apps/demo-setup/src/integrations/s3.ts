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

/* Uploads the demo page to the demo bucket at {companyId}/index.html. Returns
 * the public demo URL. detectBrand already picked which widget theme this
 * demo ships with, so there's exactly one page to upload — no unused
 * "secondary" variant sitting around for nobody to link to. */
export const uploadDemo = async (companyId: string, html: string): Promise<string> => {
  await putHtml(`${companyId}/index.html`, html)

  const demoUrl = `${env.demoBaseUrl}/${companyId}/`
  logger.info(`Uploaded demo to ${demoUrl}`)
  return demoUrl
}
