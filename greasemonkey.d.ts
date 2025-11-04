/**
 * Greasemonkey / Tampermonkey API type definitions
 */

/**
 * Gets a value from persistent storage
 * @param key - The key to retrieve
 * @param defaultValue - The default value if key doesn't exist
 */
declare function GM_getValue<T>(key: string, defaultValue?: T): T

/**
 * Sets a value in persistent storage
 * @param key - The key to set
 * @param value - The value to store
 */
declare function GM_setValue(key: string, value: any): void

/**
 * Deletes a value from persistent storage
 * @param key - The key to delete
 */
declare function GM_deleteValue(key: string): void
