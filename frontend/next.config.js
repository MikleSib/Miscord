const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.ELECTRON ? 'export' : 'standalone',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NEXT_PUBLIC_API_URL
          ? `${process.env.NEXT_PUBLIC_API_URL}/api/:path*`
          : 'https://stream-cash.ru/api/:path*',
      },
    ];
  },

  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    // Force browser build of onnxruntime-web by excluding Node-specific bundle
    config.resolve.alias['onnxruntime-web/dist/ort.node.min.mjs'] = false;
    config.resolve.alias['onnxruntime-web/dist/ort.node.mjs'] = false;
    config.resolve.alias['onnxruntime-web/dist/ort.node.js'] = false;
    config.resolve.alias['onnxruntime-node'] = false;
    config.externals.push({
      'bufferutil': 'bufferutil',
      'utf-8-validate': 'utf-8-validate',
    });
    
    // Добавляем поддержку WASM
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    
    // Ensure .mjs in node_modules is handled correctly
    config.module.rules.push({
      test: /\.mjs$/,
      include: /node_modules/,
      type: 'javascript/auto',
    });

    // Добавляем правило для WASM файлов
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });
    
    return config;
  },
}

module.exports = nextConfig