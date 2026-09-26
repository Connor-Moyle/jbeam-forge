import { FlaskConical } from 'lucide-react';
import { EmptyState } from '@renderer/ui/components/EmptyState';

export function TestResultsPanel() {
  return <EmptyState icon={FlaskConical} message="No test results. Run a physics scenario to see broken beams and unstable nodes." />;
}
