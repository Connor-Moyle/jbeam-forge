import { useEffect, useState } from 'react';
import type { ContentInfo } from '@shared/content/types';
import { call } from '@renderer/diagnostics/ipc';
import { Modal } from '@renderer/ui/components/Modal';
import { TabPanel, Tabs } from '@renderer/ui/components/Tabs';
import { AppVersions } from './AppVersions';
import { ContentTab } from './ContentTab';
import styles from './Downloads.module.css';

export type DownloadsTab = 'app' | 'textures' | 'meshes' | 'scripts';

/**
 * Downloads: JBeam Forge's own versions (update, or roll back), and the two
 * optional content repositories: textures and meshes, all or item by item.
 */
export function DownloadsWindow({ tab, onTab, onClose }: { tab: DownloadsTab; onTab: (t: DownloadsTab) => void; onClose: () => void }) {
  const [info, setInfo] = useState<ContentInfo | null>(null);
  const loadInfo = () => {
    call('content:info')
      .then(setInfo)
      .catch(() => undefined);
  };
  useEffect(loadInfo, []);
  useEffect(() => window.forge.on('content:changed', loadInfo), []);
  const count = (k: 'textures' | 'meshes' | 'scripts') => (info ? Object.keys(info[k].installed.items).length : 0);
  return (
    <Modal
      open
      size="lg"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Downloads"
    >
      <div className={styles.window} data-testid="downloads-window">
        <Tabs<DownloadsTab>
          value={tab}
          onChange={onTab}
          className={styles.tabs}
          aria-label="Downloads"
          items={[
            { value: 'app', label: 'JBeam Forge' },
            { value: 'textures', label: `Textures${count('textures') ? ` (${count('textures')})` : ''}` },
            { value: 'meshes', label: `Meshes${count('meshes') ? ` (${count('meshes')})` : ''}` },
            { value: 'scripts', label: `Scripts${count('scripts') ? ` (${count('scripts')})` : ''}` },
          ]}
        >
          <TabPanel value="app" className={styles.tabs}>
            <AppVersions />
          </TabPanel>
          <TabPanel value="textures" className={styles.tabs}>
            <ContentTab kind="textures" info={info} onInfo={loadInfo} />
          </TabPanel>
          <TabPanel value="meshes" className={styles.tabs}>
            <ContentTab kind="meshes" info={info} onInfo={loadInfo} />
          </TabPanel>
          <TabPanel value="scripts" className={styles.tabs}>
            <ContentTab kind="scripts" info={info} onInfo={loadInfo} />
          </TabPanel>
        </Tabs>
      </div>
    </Modal>
  );
}
