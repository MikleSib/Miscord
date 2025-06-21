'use client'

import React, { useState, useEffect } from 'react';
import { Settings, Volume2, VolumeX, Zap, ZapOff, Brain } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Slider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Chip,
} from '@mui/material';
import voiceService from '../services/voiceService';

interface NoiseSuppressionSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function NoiseSuppressionSettings({ open, onClose }: NoiseSuppressionSettingsProps) {
  const [settings, setSettings] = useState({
    enabled: true,
    level: 'professional' as 'basic' | 'advanced' | 'professional',
    sensitivity: 75,
    vadThreshold: -30,
    vadEnabled: true
  });
  
  const [support, setSupport] = useState({
    basic: false,
    advanced: false,
    professional: false
  });
  
  const [stats, setStats] = useState<any>(null);
  
  // Загружаем настройки при открытии
  useEffect(() => {
    if (open && typeof window !== 'undefined') {
      loadSettings();
      checkSupport();
      loadStats();
    }
  }, [open]);

  const loadSettings = () => {
    if (typeof window === 'undefined') return;
    
    try {
      const currentSettings = voiceService.getNoiseSuppressionSettings();
      setSettings(currentSettings);
    } catch (error) {
      console.error('🔇 Ошибка загрузки настроек шумодава:', error);
    }
  };

  const checkSupport = () => {
    if (typeof window === 'undefined') return;
    
    try {
      const supportInfo = voiceService.isNoiseSuppressionSupported();
      setSupport({
        ...supportInfo,
        professional: supportInfo.advanced // Профессиональный уровень требует те же возможности что и продвинутый
      });
    } catch (error) {
      console.error('🔇 Ошибка проверки поддержки шумодава:', error);
    }
  };

  const loadStats = () => {
    if (typeof window === 'undefined') return;
    
    try {
      const statsInfo = voiceService.getNoiseSuppressionStats();
      const debugInfo = voiceService.getDebugInfo();
      console.log('🔇 Отладочная информация VoiceService:', debugInfo);
      setStats(statsInfo);
    } catch (error) {
      console.error('🔇 Ошибка загрузки статистики шумодава:', error);
    }
  };

  const handleEnabledChange = (enabled: boolean) => {
    if (typeof window === 'undefined') return;
    
    setSettings(prev => ({ ...prev, enabled }));
    voiceService.setNoiseSuppressionEnabled(enabled);
  };

  const handleLevelChange = (level: 'basic' | 'advanced' | 'professional') => {
    if (typeof window === 'undefined') return;
    
    setSettings(prev => ({ ...prev, level }));
    // Пока что используем advanced для professional уровня
    if (level === 'professional') {
      voiceService.setNoiseSuppressionLevel('advanced');
    } else {
    voiceService.setNoiseSuppressionLevel(level);
    }
    
    // Обновляем статистику после изменения уровня
    setTimeout(loadStats, 500);
  };

  const handleSensitivityChange = (sensitivity: number) => {
    if (typeof window === 'undefined') return;
    
    setSettings(prev => ({ ...prev, sensitivity }));
    voiceService.setNoiseSuppressionSensitivity(sensitivity);
  };

  const handleVadThresholdChange = (threshold: number) => {
    if (typeof window === 'undefined') return;
    
    setSettings(prev => ({ ...prev, vadThreshold: threshold }));
    voiceService.setVadThreshold(threshold);
  };

  const handleVadEnabledChange = (enabled: boolean) => {
    if (typeof window === 'undefined') return;
    
    setSettings(prev => ({ ...prev, vadEnabled: enabled }));
    voiceService.setVadEnabled(enabled);
  };

  const getSensitivityLabel = (value: number) => {
    if (value < 30) return 'Низкая';
    if (value < 70) return 'Средняя';
    return 'Высокая';
  };

  const getVadThresholdLabel = (value: number) => {
    if (value <= -50) return 'Очень чувствительный';
    if (value <= -35) return 'Чувствительный';
    if (value <= -20) return 'Нормальный';
    if (value <= -10) return 'Менее чувствительный';
    return 'Только громкие звуки';
  };

  const getLevelDescription = (level: 'basic' | 'advanced' | 'professional') => {
    switch (level) {
      case 'basic':
        return 'Использует встроенное подавление шума браузера. Низкое потребление ресурсов.';
      case 'advanced':
        return 'Использует RNNoise с машинным обучением. Лучшее качество, но больше нагрузки на процессор.';
      case 'professional':
        return 'Использует наш собственный Miscord AI алгоритм. Качество уровня Krisp! ⭐';
    }
  };

  const getStatusColor = (supported: boolean, active: boolean) => {
    if (!supported) return 'error';
    if (active) return 'success';
    return 'default';
  };

  const getStatusText = (supported: boolean, active: boolean) => {
    if (!supported) return 'Не поддерживается';
    if (active) return 'Активен';
    return 'Доступен';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogContent>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
          <Volume2 size={24} />
          Настройки подавления шума
        </DialogTitle>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Основные настройки */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Основные настройки
            </Typography>
            
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enabled}
                  onChange={(e) => handleEnabledChange(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {settings.enabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
                  Включить подавление шума
                </Box>
              }
            />
          </Box>

          {/* Уровень шумодава */}
          {settings.enabled && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Уровень обработки
              </Typography>
              
              <Box sx={{ display: 'flex', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
                <Box sx={{ flex: 1 }}>
                  <Box
                    sx={{
                      p: 2,
                      border: settings.level === 'basic' ? 2 : 1,
                      borderColor: settings.level === 'basic' ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      cursor: support.basic ? 'pointer' : 'not-allowed',
                      opacity: support.basic ? 1 : 0.5,
                      bgcolor: settings.level === 'basic' ? 'primary.light' : 'transparent',
                      '&:hover': support.basic ? { bgcolor: 'action.hover' } : {}
                    }}
                    onClick={() => support.basic && handleLevelChange('basic')}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Zap size={20} />
                      <Typography variant="subtitle2">Базовый</Typography>
                      <Chip
                        size="small"
                        label={getStatusText(support.basic, settings.level === 'basic' && settings.enabled)}
                        color={getStatusColor(support.basic, settings.level === 'basic' && settings.enabled)}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {getLevelDescription('basic')}
                    </Typography>
                  </Box>
                </Box>
                
                <Box sx={{ flex: 1 }}>
                  <Box
                    sx={{
                      p: 2,
                      border: settings.level === 'advanced' ? 2 : 1,
                      borderColor: settings.level === 'advanced' ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      cursor: support.advanced ? 'pointer' : 'not-allowed',
                      opacity: support.advanced ? 1 : 0.5,
                      bgcolor: settings.level === 'advanced' ? 'primary.light' : 'transparent',
                      '&:hover': support.advanced ? { bgcolor: 'action.hover' } : {}
                    }}
                    onClick={() => support.advanced && handleLevelChange('advanced')}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <ZapOff size={20} />
                      <Typography variant="subtitle2">Продвинутый (RNNoise)</Typography>
                      <Chip
                        size="small"
                        label={getStatusText(support.advanced, settings.level === 'advanced' && settings.enabled)}
                        color={getStatusColor(support.advanced, settings.level === 'advanced' && settings.enabled)}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {getLevelDescription('advanced')}
                    </Typography>
                  </Box>
                </Box>
                
                <Box sx={{ flex: 1 }}>
                  <Box
                    sx={{
                      p: 2,
                      border: settings.level === 'professional' ? 2 : 1,
                      borderColor: settings.level === 'professional' ? 'primary.main' : 'divider',
                      borderRadius: 1,
                      cursor: support.professional ? 'pointer' : 'not-allowed',
                      opacity: support.professional ? 1 : 0.5,
                      bgcolor: settings.level === 'professional' ? 'primary.light' : 'transparent',
                      '&:hover': support.professional ? { bgcolor: 'action.hover' } : {}
                    }}
                    onClick={() => support.professional && handleLevelChange('professional')}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Brain size={20} />
                      <Typography variant="subtitle2">Профессиональный (Miscord AI) ⭐</Typography>
                      <Chip
                        size="small"
                        label={getStatusText(support.professional, settings.level === 'professional' && settings.enabled)}
                        color={getStatusColor(support.professional, settings.level === 'professional' && settings.enabled)}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      {getLevelDescription('professional')}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          )}

          {/* Чувствительность */}
          {settings.enabled && (settings.level === 'advanced' || settings.level === 'professional') && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Чувствительность: {getSensitivityLabel(settings.sensitivity)} ({settings.sensitivity}%)
              </Typography>
              <Slider
                value={settings.sensitivity}
                onChange={(_, value) => handleSensitivityChange(value as number)}
                min={0}
                max={100}
                step={5}
                marks={[
                  { value: 0, label: '0%' },
                  { value: 25, label: 'Низкая' },
                  { value: 50, label: 'Средняя' },
                  { value: 75, label: 'Высокая' },
                  { value: 100, label: '100%' }
                ]}
                sx={{ mt: 2 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Высокая чувствительность лучше подавляет шум, но может влиять на качество голоса
              </Typography>
            </Box>
          )}

          {/* Настройки активации голоса (VAD) */}
          <Box>
            <Typography variant="h6" gutterBottom>
              Активация микрофона
            </Typography>
            
            <FormControlLabel
              control={
                <Switch
                  checked={settings.vadEnabled}
                  onChange={(e) => handleVadEnabledChange(e.target.checked)}
                  color="primary"
                />
              }
              label="Активация по голосу (VAD)"
              sx={{ mb: 2 }}
            />
            
            {settings.vadEnabled && (
              <Box>
                                 <Typography variant="subtitle1" gutterBottom>
                   Порог активации: {settings.vadThreshold} дБ ({getVadThresholdLabel(settings.vadThreshold)})
                 </Typography>
                <Slider
                  value={settings.vadThreshold}
                  onChange={(_, value) => handleVadThresholdChange(value as number)}
                  min={-60}
                  max={0}
                  step={1}
                  marks={[
                    { value: -60, label: '-60 дБ (очень тихо)' },
                    { value: -40, label: '-40 дБ' },
                    { value: -20, label: '-20 дБ' },
                    { value: 0, label: '0 дБ (очень громко)' }
                  ]}
                  sx={{ mt: 2 }}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Более низкие значения (ближе к -60 дБ) = микрофон активируется при более тихих звуках.
                  Более высокие значения (ближе к 0 дБ) = нужно говорить громче для активации.
                </Typography>
              </Box>
            )}
            
            {!settings.vadEnabled && (
              <Alert severity="info" sx={{ mt: 1 }}>
                Микрофон всегда активен. VAD отключен - микрофон будет передавать звук постоянно.
              </Alert>
            )}
          </Box>

          {/* Предупреждения */}
          {!support.basic && !support.advanced && (
            <Alert severity="error">
              Ваш браузер не поддерживает подавление шума. Попробуйте использовать современную версию Chrome, Firefox или Edge.
            </Alert>
          )}

          {!support.advanced && support.basic && (
            <Alert severity="warning">
              Продвинутое подавление шума (RNNoise) не поддерживается. Доступен только базовый уровень.
            </Alert>
          )}

          {/* Статистика (для отладки) */}
          {stats && process.env.NODE_ENV === 'development' && (
            <Box>
              <Typography variant="subtitle1" gutterBottom>
                Статистика (отладка)
              </Typography>
              <Box sx={{ 
                p: 2, 
                bgcolor: 'grey.100', 
                borderRadius: 1,
                fontFamily: 'monospace',
                fontSize: '0.8rem'
              }}>
                <pre>{JSON.stringify(stats, null, 2)}</pre>
              </Box>
            </Box>
          )}

          {/* Кнопки управления */}
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 2 }}>
            <Button variant="outline" onClick={loadStats}>
              Обновить статистику
            </Button>
            <Button onClick={onClose}>
              Закрыть
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
} 