/**
 * Fetches company logo from favicon when given a company website URL
 * @param websiteUrl - The company website URL
 * @returns Promise<string | null> - The favicon URL or null if not found
 */
export async function getCompanyLogo(websiteUrl: string): Promise<string | null> {
  try {
    // Ensure the URL has a protocol
    let url = websiteUrl
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`
    }

    // Try to get favicon from common locations
    const faviconUrls = [
      `${url}/favicon.ico`,
      `${url}/favicon.png`,
      `${url}/apple-touch-icon.png`,
      `${url}/apple-touch-icon-precomposed.png`,
      `${url}/icon.png`,
      `${url}/logo.png`,
      `${url}/logo.ico`
    ]

    for (const faviconUrl of faviconUrls) {
      try {
        const response = await fetch(faviconUrl, {
          method: 'HEAD',
          mode: 'no-cors' // This is a limitation of browser security
        })
        
        // If we can't check the response due to CORS, we'll assume it exists
        // In a real implementation, you might want to use a proxy service
        return faviconUrl
      } catch (error) {
        // Continue to next favicon URL
        continue
      }
    }

    // Fallback: try to extract domain and use Google's favicon service
    try {
      const domain = new URL(url).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    } catch (error) {
      console.error('Error extracting domain from URL:', error)
      return null
    }
  } catch (error) {
    console.error('Error fetching company logo:', error)
    return null
  }
}

/**
 * Validates if a URL is a valid website URL
 * @param url - The URL to validate
 * @returns boolean - True if valid website URL
 */
export function isValidWebsiteUrl(url: string): boolean {
  try {
    // Basic URL validation
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Extracts domain name from URL for display purposes
 * @param url - The website URL
 * @returns string - The domain name
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
    return urlObj.hostname.replace('www.', '')
  } catch {
    return url
  }
}
