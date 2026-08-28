# Home-manager module for Sona speech-to-text
#
# Provides a systemd user service for autostart.
# Usage: imports = [ sona.homeManagerModules.default ];
#        services.sona.enable = true;
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.sona;
in
{
  options.services.sona = {
    enable = lib.mkEnableOption "Sona speech-to-text user service";

    package = lib.mkOption {
      type = lib.types.package;
      defaultText = lib.literalExpression "sona.packages.\${system}.sona";
      description = "The Sona package to use.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.user.services.sona = {
      Unit = {
        Description = "Sona speech-to-text";
        After = [ "graphical-session.target" ];
        PartOf = [ "graphical-session.target" ];
      };
      Service = {
        ExecStart = "${cfg.package}/bin/sona";
        Restart = "on-failure";
        RestartSec = 5;
      };
      Install.WantedBy = [ "graphical-session.target" ];
    };
  };
}
