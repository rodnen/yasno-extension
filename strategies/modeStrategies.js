// strategies/modeStrategies.js
export const MODE_STRATEGIES = {
  yasno: {
    action: 'fetchYasno',
    storageKey: ['lastGroup', 'lastOsr'],
    buildPayload: ({ group, osr, currentDayNumber, dayType }) => ({
      action: 'fetchYasno',
      group,
      osr,
      currentDayNumber,
      dayType
    }),
    getStorageData: ({ group, osr }) => ({ lastGroup: group, lastOsr: osr }),
  },

  dtek: {
    action: 'fetchDTEK',
    buildPayload: ({ group, dayType }) => ({
      action: 'fetchDTEK',
      group,
      dayType
    }),
    getStorageData: ({ group }) => ({ lastGroup: group }),
  }
};