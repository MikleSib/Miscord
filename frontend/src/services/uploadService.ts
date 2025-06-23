import api from './api';

class UploadService {
  async uploadFile(file: File): Promise<{ file_url: string }> {
    console.log('[uploadService] uploadFile', file);
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data;
  }
}

export default new UploadService(); 