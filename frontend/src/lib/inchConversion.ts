/**
 * Inch Conversion Chart
 * Based on: frontend/Templates/inch-conversion-template.svg
 * 
 * When measuring in points (like .2, .3, etc.), 
 * these are converted to decimal inches.
 * 
 * Example: 3.6 → 3.50 (because .6 = .50)
 */

// The conversion map: point value → decimal inch value
export const INCH_CONVERSION_MAP: Record<string, string> = {
  ".2": ".18",
  ".3": ".25",
  ".4": ".32",
  ".5": ".42",
  ".6": ".50",
  ".7": ".58",
  ".8": ".66",
  ".9": ".75",
  ".10": ".82",
  ".11": ".92",
};

// Special case: 1 inch = .08 (for full inch notation)
export const FULL_INCH_VALUE = ".08";

/**
 * Convert a single number with point notation to inch decimal
 * Examples:
 *   3.6 → 3.50  (because .6 = .50)
 *   5.10 → 5.82 (because .10 = .82)
 *   2.3 → 2.25  (because .3 = .25)
 *   7 → 7       (no decimal, unchanged)
 */
export function convertPointToInch(value: string | number): string {
  const strValue = String(value).trim();
  
  // If it's a whole number or doesn't have a decimal, return as is
  if (!strValue.includes('.')) {
    return strValue;
  }
  
  // Split into integer and decimal parts
  const parts = strValue.split('.');
  if (parts.length !== 2) {
    return strValue;
  }
  
  const integerPart = parts[0];
  const decimalPart = '.' + parts[1];
  
  // Check if the decimal part is in our conversion map
  const converted = INCH_CONVERSION_MAP[decimalPart];
  
  if (converted) {
    // Remove the leading dot from converted value and combine
    return integerPart + converted;
  }
  
  // If not in map, return original
  return strValue;
}

/**
 * Convert all point values in a text string
 * Finds patterns like X.Y where Y is 2-11 and converts them
 */
export function convertAllPointValues(text: string): string {
  let result = text;
  
  // Sort by length (longer patterns first) to avoid partial matches
  // e.g., .10 and .11 should be matched before .1
  const sortedPatterns = Object.entries(INCH_CONVERSION_MAP)
    .sort(([a], [b]) => b.length - a.length);
  
  for (const [point, inch] of sortedPatterns) {
    // Match number followed by the point value
    // e.g., for ".6" match "3.6" or "12.6" but not "3.66"
    const escaped = point.replace('.', '\\.');
    const regex = new RegExp(`(\\d+)${escaped}(?!\\d)`, 'g');
    result = result.replace(regex, `$1${inch}`);
  }
  
  return result;
}

/**
 * Convert measurements in extracted bill data
 * Converts quantity, rate, and amount fields that contain point notation
 */
export function convertBillMeasurements(data: {
  items: Array<{
    name: string;
    quantity?: number;
    unit?: string;
    rate?: number;
    amount: number;
  }>;
  [key: string]: any;
}): typeof data {
  return {
    ...data,
    items: data.items.map(item => {
      // Convert item name (might contain measurements)
      const convertedName = convertAllPointValues(item.name);
      
      // Convert quantity if it has point notation
      const convertedQty = item.quantity 
        ? parseFloat(convertPointToInch(item.quantity)) 
        : item.quantity;
      
      // Convert rate if it has point notation  
      const convertedRate = item.rate
        ? parseFloat(convertPointToInch(item.rate))
        : item.rate;
        
      // Convert amount if it has point notation
      const convertedAmount = parseFloat(convertPointToInch(item.amount));
      
      return {
        ...item,
        name: convertedName,
        quantity: convertedQty,
        rate: convertedRate,
        amount: convertedAmount
      };
    })
  };
}

/**
 * Get the conversion table as readable text
 * Useful for displaying to users
 */
export function getConversionTableText(): string {
  const lines = Object.entries(INCH_CONVERSION_MAP)
    .map(([point, inch]) => `${point} → ${inch}`)
    .join(', ');
  return lines;
}

/**
 * Display format for the conversion info
 */
export const CONVERSION_INFO = `
Inch Conversion Chart:
.2 = .18   .3 = .25   .4 = .32
.5 = .42   .6 = .50   .7 = .58
.8 = .66   .9 = .75   .10 = .82
.11 = .92  (1 inch = .08)

Example: 3.6 becomes 3.50
`;
