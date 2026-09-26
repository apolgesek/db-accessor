import { DetectPiiResult } from '../../shared/pii-detection';
import { aggregateSuggestions } from './suggestion-aggregator';

describe('aggregateSuggestions', () => {
  test('deduplicates support by record and merges evidence deterministically', () => {
    const observations = [
      { id: '0:0', path: 'contacts[].email' },
      { id: '0:1', path: 'contacts[].email' },
      { id: '1:0', path: 'contacts[].email' },
      { id: '1:1', path: 'name' },
    ];
    const recordIndexById = new Map([
      ['0:0', 0],
      ['0:1', 0],
      ['1:0', 1],
      ['1:1', 1],
    ]);
    const results: DetectPiiResult[] = observations.map((observation, index) => ({
      ...observation,
      status: 'DETECTED',
      detections: [
        {
          entityType: observation.path === 'name' ? 'PERSON' : 'EMAIL_ADDRESS',
          confidence: observation.path === 'name' ? 0.65 : index === 0 ? 0.9 : 0.99,
          evidence: [
            {
              source: index === 0 ? 'PATH_RULE' : 'VALUE_VALIDATOR',
              ruleId: index === 0 ? 'email.path' : 'email.value',
              confidence: index === 0 ? 0.9 : 0.99,
            },
          ],
        },
      ],
    }));

    const suggestions = aggregateSuggestions(observations, recordIndexById, results);

    expect(suggestions.map((suggestion) => suggestion.path)).toEqual(['contacts[].email', 'name']);
    expect(suggestions[0]).toMatchObject({
      confidence: 0.99,
      observedRecordCount: 2,
      detectedRecordCount: 2,
      detections: [{ entityType: 'EMAIL_ADDRESS', confidence: 0.99, detectedRecordCount: 2 }],
    });
    expect(suggestions[0].detections[0].evidence).toHaveLength(2);
  });
});
