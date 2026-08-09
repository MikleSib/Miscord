import api from './api';

export interface UploadedChatFile {
  upload_id: string
  file_url: string
  filename: string
  content_type: string
  size_bytes: number
}

class UploadService {
  async uploadFile(file: File, options: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void } = {}): Promise<UploadedChatFile> {
    console.log('[uploadService] uploadFile', file);
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post('/api/v1/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      signal: options.signal,
      onUploadProgress: (event) => options.onProgress?.(event.loaded, event.total || file.size),
    });

    return response.data;
  }

  async deleteUpload(uploadId: string): Promise<void> {
    await api.delete(`/api/v1/uploads/${uploadId}`)
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
