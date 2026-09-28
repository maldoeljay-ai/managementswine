/**
 * Utility functions for SwineSync
 */

/**
 * Formats a given date string into a word-based date (e.g., "August 10, 2026")
 * @param {string|Date} dateString - The date string or object to format
 * @returns {string} The formatted date
 */
export function formatDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  // Handle invalid dates
  if (isNaN(date.getTime())) return dateString;
  
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}
