// This file contains the development configuration for Webpack.
// Webpack is used to bundle our source code, in order to optimize which
// scripts are loaded and all required files to run the application are
// neatly put into the build directory.

const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const webpack = require('webpack');

let rendererConfig = {
  mode: 'production',
  entry: './src/renderer.tsx',
  // The renderer runs inside Tauri's WebView2, which is a plain browser
  // environment: no Node. `web` target guarantees nothing is left as an
  // external `require()` call.
  target: ['web', 'es2022'],
  // Node built-ins (path, os, fs, ...) are NOT available in the Tauri WebView,
  // so keep them bundled via the aliases/fallbacks below.
  externalsPresets: {
    node: false,
  },
  output: {
    filename: 'renderer.bundle.js',
    path: __dirname + '/build',
    clean: true,
  },
  node: {
    // Tauri's WebView has no Node globals; mock them so module-level
    // `__dirname`/`__filename` references (e.g. common/fs.ts) don't throw.
    __dirname: 'mock',
    __filename: 'mock',
  },
  experiments: {},
  resolve: {
    extensions: ['.js', '.json', '.ts', '.tsx', '.svg'],
    alias: {
      common: path.resolve(__dirname, 'common/'),
      widgets: path.resolve(__dirname, 'widgets/'),
      resources: path.resolve(__dirname, 'resources/'),
      src: path.resolve(__dirname, 'src/'),
      'fs-extra': path.resolve(__dirname, 'src/frontend/services/fs-shim.js'),
      fs: path.resolve(__dirname, 'src/frontend/services/fs-shim.js'),
      path: path.resolve(__dirname, 'src/frontend/services/path-shim.js'),
      os: path.resolve(__dirname, 'src/frontend/services/os-shim.js'),
    },
    fallback: {
      fs: false,
      child_process: false,
      net: false,
      tls: false,
      path: path.resolve(__dirname, 'src/frontend/services/path-shim.js'),
      events: path.resolve(__dirname, 'node_modules/events/events.js'),
      stream: path.resolve(__dirname, 'src/frontend/services/stream-shim.js'),
      util: path.resolve(__dirname, 'src/frontend/services/util-shim.js'),
      buffer: false,
      crypto: false,
      http: false,
      https: false,
      url: false,
      querystring: false,
      zlib: false,
      assert: false,
      constants: false,
    },
  },
  module: {
    rules: [
      {
        // All files with a '.ts' or '.tsx' extension will be handled by 'ts-loader'.
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
        },
      },
      {
        test: /\.(scss|css)$/,
        use: [
          {
            loader: MiniCssExtractPlugin.loader,
            options: {
              publicPath: './',
            },
          },
          'css-loader',
          'sass-loader',
        ],
      },
      {
        test: /\.(jpg|png|gif|ico|icns|eot|ttf|woff|woff2)$/,
        type: 'asset/resource',
      },
      {
        test: /.node$/,
        loader: 'node-loader',
      },
      {
        test: /\.js$/,
        resourceQuery: /file/,
        type: 'asset/resource',
      },
      {
        test: /\.svg$/,
        oneOf: [
          {
            issuer: /\.scss$/,
            type: 'asset/resource',
          },
          {
            issuer: /.tsx?$/,
            loader: '@svgr/webpack',
          },
        ],
      },
    ],
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: path.resolve(__dirname, 'src/frontend/services/process-shim.js'),
    }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, './src/index.html'),
    }),
    new MiniCssExtractPlugin({
      filename: '[name].[contenthash].css',
      chunkFilename: '[id].[contenthash].css',
    }),
  ],
};

module.exports = [rendererConfig];
