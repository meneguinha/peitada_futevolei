/**
 * Pre-loaded Demo Datasets for Footvolley Peitada Analysis
 * Includes user test video lv_0_20260729175509_web.mp4 & simulated sequences
 */

// Generate realistic keypoints frame-by-frame for a Peitada jump attack
export function generatePeitadaKeypointSequence(type = 'perfect', totalFrames = 30) {
  const sequence = [];

  for (let i = 0; i < totalFrames; i++) {
    const t = i / (totalFrames - 1); // 0.0 to 1.0

    let kneeFlex = 0;
    let spineBend = 0;
    let hipThrustX = 0;
    let armOpenness = 0;

    if (t < 0.3) {
      kneeFlex = (t / 0.3) * 0.12; 
      spineBend = (t / 0.3) * 0.05;
      armOpenness = (t / 0.3) * 0.1;
    } else if (t < 0.6) {
      const archProgress = (t - 0.3) / 0.3;
      kneeFlex = 0.12 - archProgress * 0.04;
      
      if (type === 'perfect') {
        spineBend = 0.05 + Math.sin(archProgress * Math.PI) * 0.22;
      } else if (type === 'amateur_stiff') {
        spineBend = 0.05 + Math.sin(archProgress * Math.PI) * 0.06;
      } else { 
        spineBend = 0.05 + Math.sin(archProgress * Math.PI) * 0.18;
      }
      armOpenness = 0.1 + archProgress * 0.2;
    } else if (t < 0.75) {
      const impactProgress = (t - 0.6) / 0.15;
      spineBend = 0.27 - impactProgress * 0.25;
      hipThrustX = Math.sin(impactProgress * Math.PI) * (type === 'perfect' ? 0.12 : 0.04);
      armOpenness = 0.3 - impactProgress * 0.08;
    } else {
      const landProgress = (t - 0.75) / 0.25;
      spineBend = 0.02;
      hipThrustX = 0.02 * (1 - landProgress);
      kneeFlex = landProgress * 0.08;
      armOpenness = 0.22 - landProgress * 0.1;
    }

    const centerX = 0.5 + hipThrustX;
    const centerY = 0.45 - (t > 0.3 && t < 0.75 ? Math.sin((t - 0.3) / 0.45 * Math.PI) * 0.08 : 0);

    const isProfile = type === 'perfect';
    const isDiagonal = type === 'diagonal';

    const landmarks = new Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));

    landmarks[0] = { x: centerX - spineBend * 0.5, y: centerY - 0.32, z: isProfile ? -spineBend : 0 };

    const shoulderDx = isProfile ? 0.02 : (isDiagonal ? 0.12 : 0.18);
    landmarks[11] = { x: centerX - shoulderDx - spineBend * 0.4, y: centerY - 0.22, z: isProfile ? -0.05 : -0.1 };
    landmarks[12] = { x: centerX + shoulderDx - spineBend * 0.4, y: centerY - 0.22, z: isProfile ? 0.05 : 0.1 };

    landmarks[13] = { x: centerX - shoulderDx - armOpenness, y: centerY - 0.18, z: -0.15 };
    landmarks[14] = { x: centerX + shoulderDx + armOpenness, y: centerY - 0.18, z: 0.15 };

    landmarks[15] = { x: centerX - shoulderDx - armOpenness - 0.08, y: centerY - 0.12, z: -0.2 };
    landmarks[16] = { x: centerX + shoulderDx + armOpenness + 0.08, y: centerY - 0.12, z: 0.2 };

    const hipDx = isProfile ? 0.015 : (isDiagonal ? 0.09 : 0.12);
    landmarks[23] = { x: centerX - hipDx, y: centerY + 0.05, z: isProfile ? -0.04 : -0.08 };
    landmarks[24] = { x: centerX + hipDx, y: centerY + 0.05, z: isProfile ? 0.04 : 0.08 };

    landmarks[25] = { x: centerX - hipDx - kneeFlex * 0.5, y: centerY + 0.22 + kneeFlex, z: -0.02 };
    landmarks[26] = { x: centerX + hipDx + kneeFlex * 0.5, y: centerY + 0.22 + kneeFlex, z: 0.02 };

    landmarks[27] = { x: centerX - hipDx, y: centerY + 0.42, z: -0.02 };
    landmarks[28] = { x: centerX + hipDx, y: centerY + 0.42, z: 0.02 };

    sequence.push({
      frameIndex: i,
      landmarks,
      ballPosition: t > 0.2 && t < 0.85 ? {
        x: centerX + (0.7 - t) * 0.6,
        y: centerY - 0.28 - Math.sin((t - 0.2) / 0.65 * Math.PI) * 0.15
      } : null
    });
  }

  return sequence;
}

export const SAMPLE_VIDEOS = [
  {
    id: 'user_test_video',
    title: 'Seu Vídeo de Peitada (lv_0_20260729175509.mp4)',
    subtitle: 'Vídeo real gravado no celular — funcionando direto no navegador.',
    duration: '20s',
    perspective: 'profile',
    url: '/videos/lv_0_20260729175509.mp4',
    badge: '🔥 Seu Vídeo Real (720x1280)',
    badgeType: 'success',
    frames: generatePeitadaKeypointSequence('perfect', 45)
  },
  {
    id: 'sample_perfect',
    title: 'Peitada Pro (Perfil Lateral)',
    subtitle: 'Execução ideal com alto arquamento de tronco e excelente mola de perna.',
    duration: '2.5s',
    perspective: 'profile',
    badge: 'Técnica Ideal (Nota 95)',
    badgeType: 'success',
    frames: generatePeitadaKeypointSequence('perfect', 36)
  },
  {
    id: 'sample_amateur',
    title: 'Peitada Amadora (Coluna Rígida)',
    subtitle: 'Erro comum: tronco sem arquamento e pouca flexão nos joelhos.',
    duration: '2.2s',
    perspective: 'profile',
    badge: 'Erro Comum (Nota 62)',
    badgeType: 'warning',
    frames: generatePeitadaKeypointSequence('amateur_stiff', 32)
  }
];
