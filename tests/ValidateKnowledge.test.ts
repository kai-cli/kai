import { describe, it, expect } from 'bun:test';
import { existsSync } from 'fs';
import { validateKnowledge, formatValidationReport, type ValidationReport } from '../PAI/Tools/ValidateKnowledge';
import { getKnowledgeDir } from '../hooks/lib/knowledge-schema';

const hasKnowledgeFiles = existsSync(getKnowledgeDir()) && existsSync(`${getKnowledgeDir()}/firmware.md`);

describe('ValidateKnowledge', () => {
  describe('validateKnowledge', () => {
    it('returns a report object with required fields', () => {
      const report = validateKnowledge();
      expect(report).toHaveProperty('issues');
      expect(report).toHaveProperty('filesChecked');
      expect(report).toHaveProperty('filesValid');
      expect(report).toHaveProperty('filesWithIssues');
    });

    it.skipIf(!hasKnowledgeFiles)('checks all 7 knowledge domain files', () => {
      const report = validateKnowledge();
      expect(report.filesChecked).toBe(7);
    });

    it.skipIf(!hasKnowledgeFiles)('finds no errors in properly migrated files', () => {
      const report = validateKnowledge();
      const errors = report.issues.filter(i => i.severity === 'error');
      expect(errors).toHaveLength(0);
    });

    it('reports filesValid = filesChecked when all pass', () => {
      const report = validateKnowledge();
      if (report.issues.filter(i => i.severity === 'error').length === 0) {
        expect(report.filesValid).toBe(report.filesChecked);
      }
    });

    it('issues array contains objects with file, slug, severity, message', () => {
      const report = validateKnowledge();
      for (const issue of report.issues) {
        expect(issue).toHaveProperty('file');
        expect(issue).toHaveProperty('slug');
        expect(issue).toHaveProperty('severity');
        expect(issue).toHaveProperty('message');
        expect(['error', 'warning']).toContain(issue.severity);
      }
    });

    it('validates requiredTags from domains.jsonc', () => {
      // All current files should have their required tags (we set them up in Phase 0)
      const report = validateKnowledge();
      const tagIssues = report.issues.filter(i => i.message.includes('Missing required tag'));
      expect(tagIssues).toHaveLength(0);
    });

    it('checks for broken related links', () => {
      // All current related links point to valid slugs
      const report = validateKnowledge();
      const linkIssues = report.issues.filter(i => i.message.includes('Broken related link'));
      expect(linkIssues).toHaveLength(0);
    });

    it('does not flag recently updated files as stale', () => {
      // All files were updated in May 2026, threshold is 180 days
      const report = validateKnowledge();
      const staleIssues = report.issues.filter(i => i.message.includes('Stale'));
      expect(staleIssues).toHaveLength(0);
    });
  });

  describe('formatValidationReport', () => {
    it('shows success message when no issues', () => {
      const report: ValidationReport = { issues: [], filesChecked: 7, filesValid: 7, filesWithIssues: 0 };
      const formatted = formatValidationReport(report);
      expect(formatted).toContain('All knowledge files pass validation');
    });

    it('shows error section when errors present', () => {
      const report: ValidationReport = {
        issues: [{ file: '/test.md', slug: 'test', severity: 'error', message: 'missing domain' }],
        filesChecked: 1, filesValid: 0, filesWithIssues: 1,
      };
      const formatted = formatValidationReport(report);
      expect(formatted).toContain('Errors');
      expect(formatted).toContain('missing domain');
    });

    it('shows warning section when warnings present', () => {
      const report: ValidationReport = {
        issues: [{ file: '/test.md', slug: 'test', severity: 'warning', message: 'stale file' }],
        filesChecked: 1, filesValid: 0, filesWithIssues: 1,
      };
      const formatted = formatValidationReport(report);
      expect(formatted).toContain('Warnings');
      expect(formatted).toContain('stale file');
    });

    it('shows file counts in header', () => {
      const report: ValidationReport = { issues: [], filesChecked: 5, filesValid: 5, filesWithIssues: 0 };
      const formatted = formatValidationReport(report);
      expect(formatted).toContain('Files checked: 5');
      expect(formatted).toContain('Valid: 5');
    });
  });
});
