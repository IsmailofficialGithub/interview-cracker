{
  "targets": [
    {
      "target_name": "window-manager",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": [
              "window-manager.cc",
              "app-discovery.cc"
            ],
            "libraries": [
              "-luser32.lib",
              "-lkernel32.lib",
              "-lshell32.lib",
              "-ladvapi32.lib",
              "-lshlwapi.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1
              }
            }
          }
        ],
        [
          "OS!='win'",
          {
            "sources": [
              "linux-stub.cc"
            ]
          }
        ]
      ]
    }
  ]
}

