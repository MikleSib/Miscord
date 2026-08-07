import api from './api';

export interface UploadedChatFile {
  file_url: string
  filename: string
  content_type: string
  size_bytes: number
}

class UploadService {
  async uploadFile(file: File): Promise<UploadedChatFile> {
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

  async uploadFiles(files: File[], concurrency = 3): Promise<UploadedChatFile[]> {
    const results = new Array<UploadedChatFile>(files.length)
    let cursor = 0

    const worker = async () => {
      while (cursor < files.length) {
        const index = cursor++
        results[index] = await this.uploadFile(files[index])
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
    return results
  }
}

export default new UploadService(); 
