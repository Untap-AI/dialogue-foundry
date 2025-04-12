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
  topK: number = 5,
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

    // First retrieve top 20 results from Pinecone
    const INITIAL_RESULTS = 20
    
    // Query the Pinecone index with the text query feature
    // This uses serverless Pinecone with auto-embedding
    const queryResponse = await index.searchRecords({
      query: {
        topK: INITIAL_RESULTS,
        inputs: { text: query },
        filter
      },
      fields: ['chunk_text'] // Only request chunk_text and url
    })

    // Extract the results with text
    const initialDocuments = queryResponse.result.hits
      .map(hit => {
        const fields = hit.fields
        if (!('chunk_text' in fields) || !fields.chunk_text || typeof fields.chunk_text !== 'string') return undefined

        return {
          text: fields.chunk_text,
        }
      })
      .filter((doc): doc is RetrievedDocument => doc !== undefined)

    // If we have documents to rerank, use Cohere rerank through Pinecone's inference API
    if (initialDocuments.length > 0) {
      try {
        console.log(`Initial retrieval returned ${initialDocuments.length} documents`)
        const documentsToRerank = initialDocuments.map(doc => doc.text)
        
        // Use Pinecone's inference API to rerank with Cohere
        console.log(`Reranking with Cohere rerank-3.5 model...`)
        const rerankResults = await pinecone.inference.rerank(
          "cohere-rerank-3.5",
          query,
          documentsToRerank,
          {
            topN: topK || 5,
            returnDocuments: true
          }
        )
        
        // Transform results back to our document format
        if (rerankResults.data) {
          console.log(`Reranking successful, received ${rerankResults.data.length} reranked results`)
          const rerankedDocuments = rerankResults.data.map(result => ({
            text: result.document?.text || ''
          })).filter(doc => doc.text !== '')
          
          return rerankedDocuments
        }
      } catch (rerankError) {
        console.error('Error during Cohere reranking:', rerankError)
        // Fallback to initial results if reranking fails
        return initialDocuments.slice(0, topK || 5)
      }
    }

    // Fallback to initial results if reranking wasn't successful or no results
    return initialDocuments.slice(0, topK || 5)
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

  return `Relevant information from the knowledge base:
  
  ${contextParts.join('\n\n')}`
}
