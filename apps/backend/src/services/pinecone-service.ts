import { Pinecone } from '@pinecone-database/pinecone'
import dotenv from 'dotenv'
import { cacheService } from './cache-service'

dotenv.config()

// Check for API key in environment variables
const pineconeApiKey = process.env.PINECONE_API_KEY
if (!pineconeApiKey) {
  console.error('PINECONE_API_KEY is not set in environment variables')
  process.exit(1)
}

// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: pineconeApiKey
})

type RetrievedDocument = {
  text: string
  url?: string | undefined
}

/**
 * Retrieves documents from Pinecone index based on the query
 * @param companyId The company ID to determine which index to use
 * @param query The user's query to find similar documents
 * @param topK Number of documents to retrieve (default: 5)
 * @param filter Optional metadata filter
 * @returns Array of retrieved documents with similarity scores
 */
export const retrieveDocuments = async (
  indexName: string,
  query: string,
  topK: number = 10,
  filter?: Record<string, unknown>
) => {
  try {
    // Get the index from centralized cache or initialize it
    let index = cacheService.getPineconeIndex(indexName)
    if (!index) {
      // TODO: Remove this once we have a namespace for each company
      index = pinecone.index(indexName).namespace('')
      cacheService.setPineconeIndex(indexName, index)
    }

    // Query the Pinecone index with the text query feature
    // This uses serverless Pinecone with auto-embedding
    const queryResponse = await index.searchRecords({
      query: {
        topK,
        inputs: { text: query },
        filter
        // TODO: Add reranking
      },
      fields: ['chunk_text'] // Only request chunk_text and url
    })

    // Extract and format the results with URL
    const documents = queryResponse.result.hits
      .map(hit => {
        const fields = hit.fields
        if (!('chunk_text' in fields) || !fields.chunk_text || typeof fields.chunk_text !== 'string') return undefined

        return {
          text: fields.chunk_text,
        }
      })
      .filter((doc) => doc !== undefined)

    return documents
  } catch (error) {
    console.error('Error retrieving documents from Pinecone:', error)
    return []
  }
}

/**
 * Formats retrieved documents as context for the LLM
 * @param documents The retrieved documents with URLs
 * @returns Formatted context string to append to the LLM prompt
 */
export const formatDocumentsAsContext = (documents: RetrievedDocument[]) => {
  if (!documents.length) return ''

  // Create a formatted context string from the documents
  const contextParts = documents.map((doc, index) => {
    return `
    [Document ${index + 1}]

    ${doc.text}`
  })

  return `Relevant information from the knowledge base. Use the following information only to answer the user's question::
  
  ${contextParts.join('\n\n')}`
}
