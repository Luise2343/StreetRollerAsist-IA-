import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/db.js', () => ({
  pool: {
    query: vi.fn()
  }
}));

import { waProfileRepository } from '../repositories/wa-profile.repository.js';
import { pool } from '../config/db.js';

describe('waProfileRepository', () => {
  beforeEach(() => {
    pool.query.mockClear();
  });

  describe('upsertProfileFact', () => {
    it('should upsert profile facts and return updated profile', async () => {
      const mockRow = {
        tenantId: 1,
        waId: '1234567890',
        factsJson: { referral: { ad_id: 'ad123', headline: 'Test Ad' } },
        updatedAt: new Date()
      };

      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await waProfileRepository.upsertProfileFact(1, '1234567890', {
        referral: { ad_id: 'ad123', headline: 'Test Ad' }
      });

      expect(result).toEqual(mockRow);
      expect(pool.query).toHaveBeenCalledTimes(1);
      // Verify the query contains INSERT and ON CONFLICT
      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO wa_profile');
      expect(sql).toContain('ON CONFLICT');
    });

    it('should merge facts on conflict update', async () => {
      const mockRow = {
        tenantId: 1,
        waId: '1234567890',
        factsJson: {
          name: 'John',
          referral: { ad_id: 'ad456', headline: 'New Ad' }
        },
        updatedAt: new Date()
      };

      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await waProfileRepository.upsertProfileFact(1, '1234567890', {
        referral: { ad_id: 'ad456', headline: 'New Ad' }
      });

      expect(result).toEqual(mockRow);
    });

    it('should return undefined when no rows returned', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await waProfileRepository.upsertProfileFact(1, '1234567890', {
        referral: { ad_id: 'ad789' }
      });

      expect(result).toBeUndefined();
    });
  });

  describe('getProfileFacts', () => {
    it('should return facts_json when profile exists', async () => {
      const mockFacts = { name: 'John', referral: { ad_id: 'ad123' } };
      pool.query.mockResolvedValueOnce({ rows: [{ facts_json: mockFacts }] });

      const result = await waProfileRepository.getProfileFacts(1, '1234567890');

      expect(result).toEqual(mockFacts);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT facts_json FROM wa_profile'),
        [1, '1234567890']
      );
    });

    it('should return undefined when profile does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await waProfileRepository.getProfileFacts(1, '9999999999');

      expect(result).toBeNull();
    });
  });
});
