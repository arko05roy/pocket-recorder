#pragma once
#include <vector>
#include <IPAddress.h>
#include <WString.h>

// One printer found by a scan, and which printer ports it answered on.
// queue: the IPP queue path a print server advertised (e.g. a Mac: "printers/Brother_DCP_L2520D_series").
struct Found { IPAddress ip; String name; String queue; bool p9100 = false, p631 = false, p515 = false; };
